// R3/R4: source files are read only. Only generated Markdown is written beneath wiki/.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import { extname, join, isAbsolute, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CollabError } from './store.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_BYTES = 32 * 1024 * 1024;
const active = new Set();
const paragraph = (quote, location) => ({ quote, location });

export async function extractSource(buffer, extension) {
  const warnings = [];
  let segments = [], web;
  if (extension === '.docx') {
    const { default: mammoth } = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    segments = result.value.split('\n\n').map((text, i) => paragraph(text.trim(), `段落 ${i + 1}`));
    warnings.push(...result.messages.map(message => message.message));
  } else if (extension === '.doc') {
    const { default: WordExtractor } = await import('word-extractor');
    const doc = await new WordExtractor().extract(buffer);
    segments = doc.getBody().split(/\r?\n/).map((text, i) => paragraph(text.trim(), `段落 ${i + 1}`));
  } else if (extension === '.pptx') {
    const { default: JSZip } = await import('jszip');
    const { XMLParser } = await import('fast-xml-parser');
    const zip = await JSZip.loadAsync(buffer);
    const xml = new XMLParser({ ignoreAttributes: false, preserveOrder: true, trimValues: false, parseTagValue: false });
    const child = (nodes, key) => nodes.find(node => key in node)?.[key] ?? [];
    const readXml = async name => xml.parse(await zip.file(name).async('string'));
    const presentation = child(await readXml('ppt/presentation.xml'), 'p:presentation');
    const order = child(presentation, 'p:sldIdLst').filter(node => 'p:sldId' in node);
    const rels = child(await readXml('ppt/_rels/presentation.xml.rels'), 'Relationships');
    const targets = new Map(rels.filter(node => 'Relationship' in node).map(node => [node[':@']['@_Id'], node[':@']['@_Target']]));
    const texts = nodes => nodes.flatMap(node => Object.entries(node).flatMap(([key, value]) => key === 'a:t' ? value.map(v => v['#text'] ?? '').join('') : key === 'a:br' ? ['\n'] : Array.isArray(value) ? texts(value) : []));
    for (const [i, slide] of order.entries()) {
      const target = targets.get(slide[':@']['@_r:id']);
      const name = target && (target.startsWith('/') ? target.slice(1) : posix.join('ppt', target));
      if (!name || !zip.file(name)) { warnings.push(`幻灯片 ${i + 1} 的正文部件缺失`); continue; }
      let number = 0;
      const walk = nodes => {
        for (const node of nodes) for (const [key, value] of Object.entries(node)) {
          if (key === 'a:p') segments.push(paragraph(texts(value).join(''), `幻灯片 ${i + 1} · 段落 ${++number}`));
          else if (Array.isArray(value)) walk(value);
        }
      };
      walk(await readXml(name));
      if (!number) warnings.push(`幻灯片 ${i + 1} 没有可提取文字`);
    }
  } else if (['.xlsx', '.xls', '.csv'].includes(extension)) {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    for (const name of workbook.SheetNames) for (const [cell, value] of Object.entries(workbook.Sheets[name])) {
      if (!cell.startsWith('!') && value.v !== undefined) segments.push(paragraph(XLSX.utils.format_cell(value), `工作表 ${name} · 单元格 ${cell}`));
    }
  } else if (extension === '.pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false });
    const pdf = await task.promise;
    try {
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        const text = content.items.map(item => item.str === undefined ? '' : item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
        if (!text) warnings.push(`第 ${page} 页读不清：没有可提取文字，扫描版需 OCR（本批未提供）`);
        else segments.push(paragraph(text, `页 ${page}`));
      }
    } finally { await pdf.destroy(); }
  } else if (extension === '.json') {
    const data = JSON.parse(buffer.toString('utf8'));
    const url = new URL(data.url);
    if (!['http:', 'https:'].includes(url.protocol) || typeof data.body !== 'string' || !data.body.trim() || typeof data.saved_at !== 'string' || !Number.isFinite(Date.parse(data.saved_at))) throw Error('网页摘录需要正文 body、原网址 url 和保存时间 saved_at');
    web = { url: url.href, saved_at: data.saved_at };
    segments = data.body.split(/\n\s*\n/).map((text, i) => paragraph(text, `网页正文 · 段落 ${i + 1}`));
  } else if (['.html', '.htm'].includes(extension)) {
    const { load } = await import('cheerio');
    const $ = load(buffer.toString('utf8'));
    const url = new URL($('meta[name="source-url"]').attr('content') ?? $('link[rel="canonical"]').attr('href'));
    const saved_at = $('meta[name="saved-at"]').attr('content');
    if (!['http:', 'https:'].includes(url.protocol) || !saved_at || !Number.isFinite(Date.parse(saved_at))) throw Error('网页摘录需要 source-url（或 canonical）和 saved-at 元数据');
    $('script,style,noscript,template').remove();
    web = { url: url.href, saved_at };
    const blocks = $('body p, body h1, body h2, body h3, body li, body td').toArray();
    segments = (blocks.length ? blocks.map(el => $(el).text()) : [$('body').text()]).map((text, i) => paragraph(text.trim(), `网页正文 · 段落 ${i + 1}`));
  } else if (['.md', '.txt'].includes(extension)) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const urlLine = text.match(/^(?:原网址|source_url)[:：][ \t]*(.+)$/m);
    const savedLine = text.match(/^(?:保存时间|saved_at)[:：][ \t]*(.+)$/m);
    let body = text;
    if (urlLine || savedLine) {
      if (!urlLine || !savedLine) throw Error('网页摘录必须同时提供原网址和保存时间');
      const url = new URL(urlLine[1].trim());
      const saved_at = savedLine[1].trim();
      if (!['http:', 'https:'].includes(url.protocol) || !Number.isFinite(Date.parse(saved_at))) throw Error('网页摘录的原网址或保存时间无效');
      web = { url: url.href, saved_at };
      body = body.replace(urlLine[0], '').replace(savedLine[0], '');
    }
    segments = body.trim().split(/\n(?:[ \t\r]*\n)+/).map((quote, i) => paragraph(quote, `${web ? '网页正文 · ' : ''}段落 ${i + 1}`));
  } else {
    throw Error(`读不清：尚无 ${extension || '无扩展名'} 格式解析器，请保留原件并另存为支持的格式`);
  }
  segments = segments.filter(segment => segment.quote.trim());
  if (segments.length === 0) throw Error(warnings.join('；') || '读不清：未提取到正文，可能是扫描件、空文件或不支持的内容');
  return { segments, warnings, ...(web ? { web } : {}) };
}

function markdown(result) {
  const lines = ['---', 'kind: knowledge-note', 'status: unconfirmed', `platform_id: ${JSON.stringify(result.platform_id)}`, `source: ${JSON.stringify(result.source)}`, `version: ${JSON.stringify(result.version)}`, '---', '', `# ${result.name}`, '', '> 未确认知识便签：以下为原件摘录，不代表已确认规则。', '', `原件：${result.source}`, `内容版本：sha256:${result.version}`, ''];
  if (result.web) lines.push(`原网址：${result.web.url}`, `保存时间：${result.web.saved_at}`, '');
  for (const warning of result.warnings) lines.push(`读取缺口：${warning}`, '');
  for (const [i, segment] of result.segments.entries()) {
    const url = pathToFileURL(result.source);
    if (segment.location.startsWith('页 ')) url.hash = `page=${segment.location.slice(2)}`;
    lines.push(`## 要点 ${i + 1}`, '', `位置：${segment.location}`, `原件：[打开原件](${url.href})`, `内容版本：sha256:${result.version}`, '', ...segment.quote.split('\n').map(line => `> ${line}`), '');
  }
  return lines.join('\n');
}

export async function organizePlatform(platform, excludedRoots) {
  if (active.has(platform.id)) throw new CollabError('conflict', '这个平台正在整理资料，请稍后重试');
  active.add(platform.id);
  try {
    if (!isAbsolute(platform.path)) throw new CollabError('invalid', 'platform path must be absolute');
    const root = await realpath(platform.path);
    const results = [];
    if (excludedRoots.has(root)) throw new CollabError('conflict', '该目录也被另一个平台登记，无法隔离资料');
    // Do not follow source symlinks: the registered directory is the read boundary.
    const visit = async (directory, relative = '') => {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!relative && entry.name === 'wiki') continue;
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        const source = join(directory, entry.name);
        if (excludedRoots.has(source)) continue;
        if (entry.isSymbolicLink()) { results.push({ name, source, status: 'unreadable', error: '未读取符号链接，避免越出平台目录' }); continue; }
        if (entry.isDirectory()) {
          try { await visit(source, name); } catch (error) { results.push({ name, source, status: 'unreadable', error: `目录读不清：${error.message}` }); }
          continue;
        }
        const result = { name, source, platform_id: platform.id, status: 'unreadable' };
        try {
          if (!entry.isFile()) throw Error('不是普通文件');
          if ((await lstat(source)).size > MAX_BYTES) throw Error('文件超过 32 MiB，未读取');
          const buffer = await readFile(source);
          result.version = hash(buffer);
          Object.assign(result, await extractSource(buffer, extname(entry.name).toLowerCase()));
          result.status = result.warnings.length ? 'partial' : 'read';
        } catch (error) { result.error = `读不清：${error.message}`; }
        results.push(result);
      }
    };
    await visit(root);
    const readable = results.filter(result => result.segments);
    const wiki = join(root, 'wiki');
    let wikiError;
    if (readable.length) try {
      if (excludedRoots.has(wiki)) throw Error('wiki 目录已登记为另一个平台');
      await mkdir(wiki).catch(error => { if (error.code !== 'EEXIST') throw error; });
      if (!(await lstat(wiki)).isDirectory()) throw Error('wiki 必须为平台内的普通目录');
      await writeFile(join(wiki, 'README.md'), '# 知识便签\n\n自动整理的原件摘录，未经确认。\n', { flag: 'wx' })
        .catch(error => { if (error.code !== 'EEXIST') throw error; });
    } catch (error) { wikiError = error.message; }
    for (const result of readable) {
      // Versioned names make deletion/rebuild safe and preserve older evidence.
      const name = `source-${hash(result.name).slice(0, 20)}-${result.version}.md`;
      const path = join(wiki, name);
      const content = markdown(result);
      try {
        if (wikiError) throw Error(wikiError);
        await writeFile(path, content, { flag: 'wx' }).catch(async error => {
          if (error.code !== 'EEXIST') throw error;
          if (!(await lstat(path)).isFile() || await readFile(path, 'utf8') !== content) {
            throw Error('便签路径已被占用或内容已修改，未覆盖，请核对后重试');
          }
        });
        result.note = `wiki/${name}`;
      } catch (error) { result.note_error = `便签写入失败：${error.message}`; }
    }
    return { platform_id: platform.id, results, completed_at: new Date().toISOString() };
  } finally { active.delete(platform.id); }
}
