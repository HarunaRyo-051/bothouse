import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, unlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import XLSX from 'xlsx';
import { extractSource } from './acquire.mjs';
import { platformsRoute } from './plugin.mjs';
import { Store } from './store.mjs';

async function zip(entries) {
  const file = new JSZip();
  for (const [path, content] of Object.entries(entries)) file.file(path, content);
  return file.generateAsync({ type: 'nodebuffer' });
}

test('Word paragraphs preserve order and the text of each paragraph', async () => {
  const doc = await zip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>先申请。</w:t></w:r></w:p><w:p><w:r><w:t>再审批。</w:t></w:r></w:p></w:body></w:document>',
  });
  assert.deepEqual((await extractSource(doc, '.docx')).segments, [
    { quote: '先申请。', location: '段落 1' }, { quote: '再审批。', location: '段落 2' },
  ]);
});

test('PowerPoint uses the presentation order, not internal filenames', async () => {
  const slide = text => `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const presentation = await zip({
    'ppt/presentation.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="300" r:id="rId2"/><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide1.xml': slide('第二 &amp; 最后'), 'ppt/slides/slide2.xml': slide('0007'),
  });
  assert.deepEqual((await extractSource(presentation, '.pptx')).segments, [
    { quote: '0007', location: '幻灯片 1 · 段落 1' }, { quote: '第二 & 最后', location: '幻灯片 2 · 段落 1' },
  ]);
});

test('Excel keeps worksheet names and actual cell addresses', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[], [undefined, '七日内回复。']]), '审批');
  for (const bookType of ['xlsx', 'xls']) {
    const file = XLSX.write(book, { type: 'buffer', bookType });
    assert.deepEqual((await extractSource(file, '.' + bookType)).segments, [{ quote: '七日内回复。', location: '工作表 审批 · 单元格 B2' }]);
  }
});

function pdf(text) {
  const stream = text ? `BT /F1 12 Tf 20 50 Td (${text}) Tj ET\n` : '';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`, '<< /Length 0 >>\nstream\nendstream'];
  let file = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = file.length;
    file += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset.toString().padStart(10, '0');
  });
  const xref = file.length;
  return Buffer.from(file + `xref\n0 8\n0000000000 65535 f \n${offsets.map(o => `${o} 00000 n \n`).join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test('PDF reports each page with no extractable text, including mixed documents', async () => {
  const result = await extractSource(pdf('Five days.'), '.pdf');
  assert.deepEqual(result.segments, [{ quote: 'Five days.', location: '页 1' }]);
  assert.match(result.warnings[0], /第 2 页读不清.*OCR/);
  await assert.rejects(extractSource(pdf(''), '.pdf'), /第 1 页读不清/);
});

test('organize route is owner-only, keeps platforms isolated, exposes failures, and rebuilds without changing originals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pal-organize-'));
  const a = join(root, 'a'), b = join(a, 'b'), nested = join(a, 'sources');
  await mkdir(a); await mkdir(b); await mkdir(nested);
  const original = '# Sample\n\n原网址：https://example.test/source\n保存时间：2026-11-10T10:00:00+08:00\n\n这一段是正文。\n';
  const source = join(nested, 'web.md');
  await writeFile(source, original);
  await writeFile(join(a, 'broken.docx'), 'no ZIP');
  await writeFile(join(b, 'private.md'), 'other platform only');
  await symlink(join(b, 'private.md'), join(a, 'link.md'));
  const store = new Store(':memory:');
  store.createPlatform({ id: 'a', name: 'A', path: a });
  store.createPlatform({ id: 'b', name: 'B', path: b });
  const call = async (id, method = 'POST', allowed = true) => {
    let status, body;
    await platformsRoute({ method }, { writeHead(code) { status = code; }, end(raw) { body = JSON.parse(raw); } }, `/collab/api/platforms/${id}/organize`, store, () => allowed);
    return { status, body };
  };
  try {
    assert.equal((await call('a', 'POST', false)).status, 401);
    assert.equal((await call('a', 'GET')).status, 404);
    assert.equal((await call('missing')).status, 404);
    await assert.rejects(lstat(join(a, 'wiki')), { code: 'ENOENT' });
    const res = await call('a');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results.map(r => [r.name, r.status]), [['broken.docx', 'unreadable'], ['link.md', 'unreadable'], ['sources/web.md', 'read']]);
    const web = res.body.results[2];
    assert.equal(web.web.url, 'https://example.test/source');
    assert.equal(web.web.saved_at, '2026-11-10T10:00:00+08:00');
    assert.ok(web.segments.some(s => s.quote === '这一段是正文。'));
    const notePath = join(a, web.note);
    const note = await readFile(notePath, 'utf8');
    assert.match(note, /status: unconfirmed/);
    assert.match(note, /网页正文 · 段落 \d+/);
    assert.ok(note.includes(`sha256:${web.version}`));
    await lstat(join(a, 'wiki', 'README.md'));
    assert.equal((await call('a')).body.results[2].note, web.note);
    assert.ok((await lstat(notePath)).isFile());
    await unlink(notePath); // exact generated fixture note, never an original
    assert.equal((await call('a')).body.results[2].note, web.note);
    assert.equal(await readFile(notePath, 'utf8'), note);
    assert.equal(await readFile(source, 'utf8'), original);
    await assert.rejects(lstat(join(b, 'wiki')), { code: 'ENOENT' });
    await writeFile(source, original.replace('正文', '新版正文'));
    const updated = (await call('a')).body.results[2];
    assert.notEqual(updated.version, web.version);
    assert.notEqual(updated.note, web.note);
    await mkdir(join(b, 'output'));
    await symlink(join(b, 'output'), join(b, 'wiki'));
    const blocked = (await call('b')).body.results.find(r => r.name === 'private.md');
    assert.equal(blocked.status, 'read');
    assert.match(blocked.note_error, /普通目录/);
    assert.equal(blocked.note, undefined);
    await assert.rejects(lstat(join(b, 'output', 'README.md')), { code: 'ENOENT' });
  } finally { store.close(); }
});
