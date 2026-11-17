import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Store } from './store.mjs';
import { platformsRoute } from './plugin.mjs';
import { Hub } from './hub.mjs';
import { Tasks } from './tasks.mjs';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('old task tables gain platform_id on reopen', () => {
  const file = join(tmpdir(), `platform-migration-${process.pid}.sqlite`);
  rmSync(file, { force: true });
  const store = new Store(file);
  store.db.exec('ALTER TABLE tasks RENAME TO tasks_newer');
  store.db.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, room_id INTEGER NOT NULL REFERENCES rooms(id),
    title TEXT NOT NULL, owner TEXT NOT NULL, created_by TEXT NOT NULL, status TEXT NOT NULL,
    created_at REAL NOT NULL, updated_at REAL NOT NULL)`);
  store.db.exec('DROP TABLE tasks_newer');
  store.close();
  const reopened = new Store(file);
  try { assert.ok(reopened.db.prepare('PRAGMA table_info(tasks)').all().some(column => column.name === 'platform_id')); }
  finally { reopened.close(); rmSync(file, { force: true }); }
});

function response() {
  let status, result;
  return { res: { writeHead(code) { status = code; }, end(data) { result = JSON.parse(data); } }, get: () => ({ status, result }) };
}

test('platform CRUD validates paths and deduplicates real directories', async () => {
  const store = new Store(':memory:');
  const root = mkdtempSync(join(tmpdir(), 'platform-duplicate-'));
  const folder = join(root, 'folder');
  const alias = join(root, 'alias');
  mkdirSync(folder);
  symlinkSync(folder, alias);
  const call = async (method, path, body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    const out = response();
    await platformsRoute(req, out.res, path, store, () => true);
    return out.get();
  };
  try {
    assert.equal((await call('POST', '/collab/api/platforms', { id: 'missing', name: 'Missing', path: join(root, 'missing') })).status, 400);
    assert.equal((await call('POST', '/collab/api/platforms', { id: 'relative', name: 'Relative', path: 'relative' })).status, 400);
    assert.equal((await call('POST', '/collab/api/platforms', { id: 'a', name: 'A', path: folder, is_public: true })).status, 200);
    const trailingSlash = await call('POST', '/collab/api/platforms', { id: 'slash', name: 'Slash', path: `${folder}/` });
    assert.equal(trailingSlash.status, 409);
    assert.equal(trailingSlash.result.error, '这个文件夹已经登记过了：A');
    const symlink = await call('POST', '/collab/api/platforms', { id: 'link', name: 'Link', path: alias });
    assert.equal(symlink.status, 409);
    assert.equal(symlink.result.error, '这个文件夹已经登记过了：A');
    assert.equal((await call('GET', '/collab/api/platforms')).result.platforms.length, 1);
    const plainFile = new URL('./platforms.test.mjs', import.meta.url).pathname;
    assert.equal((await call('POST', '/collab/api/platforms', { id: 'file', name: 'File', path: plainFile })).status, 400);
    assert.equal((await call('PATCH', '/collab/api/platforms/a', { path: plainFile })).status, 400);
    assert.equal(store.platform('a').path, folder);
    assert.equal((await call('PATCH', '/collab/api/platforms/a', { name: 'A2' })).result.platform.name, 'A2');
    const second = join(root, 'second');
    mkdirSync(second);
    assert.equal((await call('POST', '/collab/api/platforms', { id: 'b', name: 'B', path: second })).status, 200);
    const editDuplicate = await call('PATCH', '/collab/api/platforms/b', { path: alias });
    assert.equal(editDuplicate.status, 409);
    assert.equal(editDuplicate.result.error, '这个文件夹已经登记过了：A2');
    assert.equal(store.platform('b').path, second);
    assert.equal((await call('DELETE', '/collab/api/platforms/a')).status, 200);
    assert.equal((await call('DELETE', '/collab/api/platforms/b')).status, 200);
    assert.deepEqual(store.listPlatforms(), []);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('tasks store platform binding and distinguish unspecified prompt constraint', () => {
  const hub = new Hub(new Store(':memory:'));
  const store = hub.store;
  store.ensureRoom(1, 'room');
  hub.setMember({ id: 'owner', name: 'Owner', kind: 'human', online: true });
  hub.setMember({ id: 'worker', name: 'Worker', kind: 'dsh', online: true });
  const tasks = new Tasks(hub, { start: false });
  try {
    store.createPlatform({ id: 'a', name: 'A', path: process.cwd() });
    const make = platform_id => tasks.perform('assign', { roomId: 1, body: { title: `Task ${platform_id ?? 'none'}`, owner: 'worker', ref: '无（新建）', platform_id, force: true } }, { actor: 'owner', verified: true });
    const unbound = make(null);
    const bound = make('a');
    assert.match(unbound.prompt_constraint, /本次未指定平台，不得引用任何平台规则/);
    assert.equal(unbound.platform_id, null);
    assert.equal(bound.platform_id, 'a');
    assert.match(bound.prompt_constraint, /本次事项平台：A/);
    assert.equal(tasks.setPlatform(bound.id, null).platform_id, null);
  } finally { tasks.close(); store.close(); }
});


test('platform file listing is shallow, capped, read only and validates paths', async () => {
  const store = new Store(':memory:');
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } = await import('node:fs');
  const folder = mkdtempSync(join(tmpdir(), 'platform-files-'));
  const call = async (id, method = 'GET', authorized = true) => {
    const out = response();
    await platformsRoute({ method }, out.res, `/collab/api/platforms/${id}/files`, store, () => authorized);
    return out.get();
  };
  try {
    mkdirSync(join(folder, 'nested'));
    writeFileSync(join(folder, 'note.txt'), 'untouched');
    writeFileSync(join(folder, 'nested', 'hidden.txt'), 'nested');
    store.createPlatform({ id: 'a', name: 'A', path: folder });
    const before = readdirSync(folder);
    const listed = await call('a');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.result.files.map(f => f.name), ['nested', 'note.txt']);
    assert.equal(listed.result.files[0].isDir, true);
    assert.equal(listed.result.files[1].size, 9);
    assert.equal(typeof listed.result.files[1].mtime, 'number');
    assert.deepEqual(Object.keys(listed.result.files[1]).sort(), ['isDir', 'mtime', 'name', 'size']);
    assert.equal((await call('a', 'GET', false)).status, 401);
    for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await call('a', method)).status, 404);
    assert.deepEqual(readdirSync(folder), before);
    assert.equal(readFileSync(join(folder, 'note.txt'), 'utf8'), 'untouched');
    for (let i = 0; i < 201; i++) writeFileSync(join(folder, `file-${i}`), '');
    const capped = await call('a');
    assert.equal(capped.result.files.length, 200);
    assert.equal(capped.result.truncated, true);
    assert.equal((await call('unknown')).status, 404);
    store.updatePlatform('a', { path: join(folder, 'missing') });
    assert.equal((await call('a')).status, 404);
    store.updatePlatform('a', { path: join(folder, 'note.txt') });
    assert.equal((await call('a')).status, 400);
    store.updatePlatform('a', { path: 'relative' });
    assert.equal((await call('a')).status, 400);
  } finally {
    store.close();
    // Temporary fixture directory is left for OS cleanup.
  }
});
