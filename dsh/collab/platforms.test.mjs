import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Store } from './store.mjs';
import { platformsRoute } from './plugin.mjs';
import { Hub } from './hub.mjs';
import { Tasks } from './tasks.mjs';
import { rmSync } from 'node:fs';
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

test('platform CRUD validates paths and preserves user files', async () => {
  const store = new Store(':memory:');
  const call = async (method, path, body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    const out = response();
    await platformsRoute(req, out.res, path, store, () => true);
    return out.get();
  };
  try {
    assert.equal((await call('POST', '/collab/api/platforms', { id: 'a', name: 'A', path: '/not-a-real-platform-path' })).status, 400);
    assert.equal((await call('POST', '/collab/api/platforms', { id: 'a', name: 'A', path: 'relative' })).status, 400);
    assert.equal((await call('POST', '/collab/api/platforms', { id: 'a', name: 'A', path: process.cwd(), is_public: true })).status, 200);
    assert.equal((await call('POST', '/collab/api/platforms', { id: 'a', name: 'Again', path: process.cwd() })).status, 409);
    assert.equal((await call('GET', '/collab/api/platforms')).result.platforms.length, 1);
    assert.equal((await call('PATCH', '/collab/api/platforms/a', { name: 'A2' })).result.platform.name, 'A2');
    assert.equal((await call('DELETE', '/collab/api/platforms/a')).status, 200);
    assert.deepEqual(store.listPlatforms(), []);
  } finally { store.close(); }
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
