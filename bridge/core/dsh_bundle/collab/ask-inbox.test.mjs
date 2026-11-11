import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Store } from './store.mjs';
import { Hub } from './hub.mjs';
import { TeamExit } from './team-exit.mjs';
import { asksRoute } from './plugin.mjs';
import { ChannelApprovals } from './approvals.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
test('workspace approval shares one request across channel and workspace', async () => {
  const store = new Store(':memory:');
  try {
    store.ensureRoom(1, 'chat');
    const hub = new Hub(store, { warn() {}, info() {} });
    hub.setMember({ id: 'ds', name: 'Astra', kind: 'dsh', online: true });
    const ws = store.createWorkspace(1);
    const approvals = ChannelApprovals.of(hub);
    let executions = 0;
    for (const [choice, expected] of [['allow', 'allowed'], ['deny', 'denied'], ['allow_all', 'allowed_all']]) {
      const { messageId, decision } = approvals.open({ room: ws.id, author: { id: 'ds', name: 'Astra' }, text: 'run tests', onDecide() { executions++; } });
      const copy = store.page(1).find(m => JSON.parse(m.card ?? 'null')?.request_id === messageId);
      assert.ok(copy, 'the channel has a replyable request reference');
      approvals.decide(copy.id, choice);
      assert.equal(await decision, choice);
      assert.equal(JSON.parse(store.message(messageId).card).state, expected);
      assert.equal(JSON.parse(store.message(copy.id).card).state, expected);
      assert.throws(() => approvals.decide(messageId, choice), /已经处理/);
      assert.throws(() => approvals.decide(copy.id, choice), /已经处理/);
    }
    assert.equal(executions, 3);
    const open = approvals.open({ room: ws.id, author: { id: 'ds', name: 'Astra' }, text: 'text response' });
    const response = hub.post(1, { authorKind: 'user', author: 'owner', name: 'Owner', text: '拒绝' }).message;
    approvals.answerByText(response);
    assert.equal(await open.decision, 'deny');
    assert.equal(JSON.parse(store.message(open.messageId).card).state, 'denied');
    const expired = approvals.open({ room: ws.id, author: { id: 'ds', name: 'Astra' }, text: 'cancelled' });
    const expiredCopy = store.page(1).find(m => JSON.parse(m.card ?? 'null')?.request_id === expired.messageId);
    approvals.expire(expired.messageId);
    assert.equal(await expired.decision, 'expired');
    assert.equal(JSON.parse(store.message(expiredCopy.id).card).state, 'expired');
  } finally { store.close(); }
});

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
    const approvals = ChannelApprovals.of(hub);
    const permission = approvals.open({ room: ws.id, author: { id: 'ds', name: 'Astra' }, text: 'run tests' });
    const trigger = hub.post(ws.id, { authorKind: 'user', author: 'owner', name: 'Owner', text: 'test' }).message;
    const job = store.addJob('ds', ws.id, trigger.id);
    store.finishJob(job.id, 'failed');
    hub.post(ws.id, { authorKind: 'system', author: 'system', name: 'system', text: 'model unavailable', card: JSON.stringify({ state: 'failed', action: 'configure-model', job_id: job.id, member_id: 'ds' }) });
    const pending = await request('GET', '/collab/api/rooms/1/pending');
    assert.equal(pending.ask.length, 1);
    assert.equal(pending.approval.length, 1);
    assert.equal(pending.failed.length, 1);
    assert.equal(pending.approval[0].message_id, permission.messageId);
    assert.equal(pending.failed[0].job_id, job.id);
    assert.deepEqual((await request('GET', '/collab/api/rooms/2/pending')).approval, []);
    approvals.decide(permission.messageId, 'deny');
    assert.deepEqual((await request('GET', '/collab/api/rooms/1/pending')).approval, []);
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
    assert.equal(store.page(ws.id).filter(m => m.author_kind === 'user' && m.text.includes('选蓝色')).length, 1);
    assert.deepEqual((await request('GET', '/collab/api/rooms/1/asks')).asks, []);
  } finally { store.close(); }
});
