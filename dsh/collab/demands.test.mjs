import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { Store } from './store.mjs';
import { demandsRoute } from './plugin.mjs';

test('demand API lists, creates, edits and deletes records with validated fields', async () => {
  const store = new Store(':memory:');
  const call = async (method, path = '/collab/api/demands', body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.method = method;
    let status, result;
    const res = { writeHead(code) { status = code; }, end(data) { result = JSON.parse(data); } };
    await demandsRoute(req, res, path, store);
    return { status, result };
  };
  try {
    assert.deepEqual(await call('GET'), { status: 200, result: { demands: [] } });
    assert.equal((await call('POST', undefined, { title: '  Improve search  ', source: 'feedback' })).status, 200);
    const created = (await call('GET')).result.demands[0];
    assert.equal(created.title, 'Improve search');
    assert.equal(created.source, 'feedback');
    assert.equal(created.priority, 'P2');
    assert.equal(created.status, 'draft');
    const path = `/collab/api/demands/${created.id}`;
    const changed = await call('PATCH', path, { why: 'Faster navigation', accept: 'Search returns results', priority: 'P0', status: 'ready' });
    assert.equal(changed.status, 200);
    assert.equal(changed.result.demand.status, 'ready');
    assert.equal(changed.result.demand.accept, 'Search returns results');
    for (const body of [{}, { title: '  ' }, { priority: 'P3' }, { status: 'done' }]) {
      assert.equal((await call('POST', undefined, body)).status, 400);
    }
    for (const body of [{ title: '' }, { priority: 'P3' }, { status: 'done' }]) {
      assert.equal((await call('PATCH', path, body)).status, 400);
    }
    assert.equal((await call('PATCH', '/collab/api/demands/999', { why: 'x' })).status, 404);
    assert.equal((await call('DELETE', '/collab/api/demands/999')).status, 404);
    assert.deepEqual(await call('DELETE', path), { status: 200, result: { ok: true } });
    assert.deepEqual((await call('GET')).result.demands, []);
  } finally {
    store.close();
  }
});
