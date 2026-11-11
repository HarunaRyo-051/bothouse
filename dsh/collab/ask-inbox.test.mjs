import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { TeamExit } from './team-exit.mjs';
import { asksRoute } from './plugin.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
test('ask inbox lists only this channel, delivers answers, rearms watch and deduplicates', async () => {
  const store = new Store(':memory:');
  try {
    store.ensureRoom(1, 'chat'); store.ensureRoom(2, 'other');
    const hub = new Hub(store, { warn() {}, info() {} });
    hub.setMember({ id: 'ds', name: 'Astra', kind: 'dsh', online: true });
    let rearmed = 0;
    hub.tasks = { task: id => id === 1 ? { id, title: 'Question' } : undefined, rewatch() { rearmed++; } };
    hub.teamExit = new TeamExit(hub);
    const ws = store.createWorkspace(1);
    hub.post(ws.id, { authorKind: 'role', author: 'ds', name: 'Astra', text: '【问】#1 背景：选颜色\n已经试过。\n要你做的：选择红色还是蓝色\n我加的：无\n自验：无需\n类别：方向' });
    await tick();
    async function request(method, path, body) {
      const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []); req.method = method;
      let status, result;
      const res = { writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } };
      await asksRoute(req, res, path, { store, hub, ownerName: 'Owner' });
      return { status, ...result };
    }
    const list = await request('GET', '/collab/api/rooms/1/asks');
    assert.equal(list.asks.length, 1);
    const ask = list.asks[0];
    assert.equal(ask.task_id, 1); assert.equal(ask.member_name, 'Astra');
    assert.match(ask.text, /选择红色还是蓝色/);
    assert.equal((await request('GET', '/collab/api/rooms/2/asks')).asks.length, 0);
    assert.equal((await request('POST', `/collab/api/asks/${ask.id}/answer`, { text: ' ' })).status, 400);
    const answered = await request('POST', `/collab/api/asks/${ask.id}/answer`, { text: '选蓝色' });
    assert.deepEqual(answered.asks, []);
    await tick();
    assert.equal(store.db.prepare('SELECT answered FROM team_exit_asks WHERE id = ?').get(ask.id).answered, 1);
    assert.equal(rearmed, 1);
    assert.equal(store.page(ws.id).filter(m => m.author_kind === 'user' && m.text.includes('选蓝色')).length, 1);
    assert.deepEqual((await request('POST', `/collab/api/asks/${ask.id}/answer`, { text: '选蓝色' })).asks, []);
    await tick();
    assert.equal(rearmed, 1);
    assert.equal(store.page(ws.id).filter(m => m.author_kind === 'user').length, 1);
    assert.deepEqual((await request('GET', '/collab/api/rooms/1/asks')).asks, []);
  } finally { store.close(); }
});
