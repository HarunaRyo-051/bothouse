import test from 'node:test';
import assert from 'node:assert/strict';
import { GateContext } from './gate-context.mjs';
import { fileURLToPath } from 'node:url';
import { DshMembers } from './dsh-member.mjs';

// Existing source directories stand in for platform roots; fetch never contacts a gate.
const root = fileURLToPath(new URL('.', import.meta.url));
const a = fileURLToPath(new URL('../packages/client-ui-discord', import.meta.url));
const b = fileURLToPath(new URL('../../docs', import.meta.url));
const wiki = [
  { path: `${a}/package.json`, desc: 'A' },
  { path: `${b}/GOALS.md`, desc: 'B' },
  { path: `${root}gate-context.mjs`, desc: 'public' },
  { path: '【任务板 room】', desc: 'board' },
];

for (const scenario of [
  { name: 'A', platform: 'a', public: true, expected: ['A', 'public', 'board'] },
  { name: 'B', platform: 'b', public: true, expected: ['B', 'public', 'board'] },
  { name: 'unbound', platform: null, public: true, expected: ['public', 'board'] },
  { name: 'no public roots', platform: null, public: false, expected: ['board'] },
  { name: 'missing platform', platform: 'gone', public: true, expected: ['board'] },
]) test(`turnContext wires allowedRoots: ${scenario.name}`, async () => {
  const platforms = [
    { id: 'a', name: 'A', path: a }, { id: 'b', name: 'B', path: b },
    { id: 'gone', name: 'Gone', path: `${root}missing-directory` },
    ...(scenario.public ? [{ id: 'public', path: root, is_public: 1 }] : []),
  ];
  const context = {
    store: {
      db: { prepare: () => ({ get: () => ({ platform_id: scenario.platform }) }) },
      platform: id => platforms.find(p => p.id === id), listPlatforms: () => platforms,
    },
    gateContext: new GateContext({ port: '1', fetch: async () => ({ ok: true, json: async () => ({ wiki }) }) }),
    memoryIndex: { turn: () => ({ block: '', commit() {} }) },
    memoryForum: { select: () => [], remember() {}, block: () => '' },
  };
  const result = await DshMembers.prototype.turnContext.call(context, { id: 'sol' }, { id: 1 }, 'session', [{ text: 'query' }]);
  for (const entry of wiki) assert.equal(result.block.includes(`— ${entry.desc}`), scenario.expected.includes(entry.desc), entry.desc);
  if (scenario.platform === 'gone') assert.match(result.block, /平台文件夹找不到，本次未查该平台资料/);
  if (!scenario.platform) assert.match(result.block, /本次未指定平台/);
  if (!scenario.public && !scenario.platform) assert.match(result.block, /本次未查任何规范资料/);
});
