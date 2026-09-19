import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { dataDirectory, PlanStore, StoreError } from '../mcp/src/store.js';
import { plan, temporaryDirectory } from './fixtures.js';

const code = (expected: string) => (error: unknown) => error instanceof StoreError && error.code === expected;

test('requires initialization, then round-trips the complete agreed plan through disk', async t => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  assert.equal(await store.get('session-a'), null);
  await assert.rejects(store.save('session-a', randomUUID(), plan), code('NOT_INITIALIZED'));
  const empty = await store.reset('session-a');
  assert.equal(empty.plan, null);
  const saved = await store.save('session-a', empty.revision, plan);
  assert.deepEqual(saved.plan, plan);
  assert.notEqual(saved.revision, empty.revision);
  assert.deepEqual(await new PlanStore(directory).get('session-a'), saved);
  const [filename] = await readdir(directory);
  assert.ok(filename);
  assert.deepEqual(JSON.parse(await readFile(join(directory, filename), 'utf8')), saved);
});

test('reset discards the whole selected plan and never changes another session', async t => {
  const store = new PlanStore(await temporaryDirectory(t));
  const a = await store.reset('session-a');
  const b = await store.reset('session-b');
  await store.save('session-a', a.revision, plan);
  const other = await store.save('session-b', b.revision, { ...plan, request: '別の依頼' });
  const reset = await store.reset('session-a');
  assert.equal(reset.plan, null);
  assert.deepEqual(await store.get('session-b'), other);
  await assert.rejects(store.save('session-a', a.revision, plan), code('REVISION_CONFLICT'));
});

test('full writeback replaces removed tasks and fields; stale revisions cannot overwrite it', async t => {
  const store = new PlanStore(await temporaryDirectory(t));
  const empty = await store.reset('writeback');
  const first = await store.save('writeback', empty.revision, {
    ...plan, tasks: [...plan.tasks, { ...plan.tasks[0]!, id: 'T2', dependsOn: ['T1'] }],
  });
  const nextPlan = { ...plan, constraints: [], approval: { mode: 'waived', evidence: '今回の承認手続きを省略するという明示指示。' } };
  const next = await store.save('writeback', first.revision, nextPlan);
  assert.equal(next.plan?.tasks.length, 1);
  assert.deepEqual(next.plan?.constraints, []);
  await assert.rejects(store.save('writeback', first.revision, plan), code('REVISION_CONFLICT'));
  assert.deepEqual(await store.get('writeback'), next);
});

test('invalid plans leave the previously approved snapshot intact', async t => {
  const store = new PlanStore(await temporaryDirectory(t));
  const empty = await store.reset('validation');
  const saved = await store.save('validation', empty.revision, plan);
  for (const invalid of [
    { ...plan, approval: { mode: 'pending', evidence: '未承認' } },
    { ...plan, approval: { mode: 'approved', evidence: '  ' } },
    { ...plan, conversation: '未確定な会話' },
    { ...plan, tasks: [plan.tasks[0], plan.tasks[0]] },
    { ...plan, tasks: [{ ...plan.tasks[0], dependsOn: ['missing'] }] },
    { ...plan, tasks: [{ ...plan.tasks[0], dependsOn: ['T1'] }] },
    { ...plan, tasks: [] },
  ]) {
    await assert.rejects(store.save('validation', saved.revision, invalid));
    assert.deepEqual(await store.get('validation'), saved);
  }
});

test('concurrent store instances cannot silently overwrite the same revision', async t => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  const empty = await store.reset('race');
  const results = await Promise.allSettled([
    store.save('race', empty.revision, { ...plan, request: 'A' }),
    new PlanStore(directory).save('race', empty.revision, { ...plan, request: 'B' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected');
  assert.ok(code('SESSION_BUSY')(rejected.reason) || code('REVISION_CONFLICT')(rejected.reason));
  assert.equal((await readdir(directory)).length, 1);
});

test('IDs cannot escape storage and remain distinct on Windows', async t => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  for (const id of ['../outside', 'a/b', 'a\\b', '', 'a'.repeat(129)]) await assert.rejects(store.reset(id));
  for (const id of ['CON', 'session-A', 'session-a']) await store.reset(id);
  assert.equal((await readdir(directory)).length, 3);
  assert.equal((await store.get('session-A'))?.sessionId, 'session-A');
  assert.equal((await store.get('session-a'))?.sessionId, 'session-a');
});

test('corrupt snapshots are reported, and only an explicit reset recovers them', async t => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  await store.reset('corrupt');
  const filename = join(directory, `${createHash('sha256').update('corrupt').digest('hex')}.json`);
  await writeFile(filename, '{broken');
  await assert.rejects(store.get('corrupt'), code('INVALID_DATA'));
  assert.equal(await readFile(filename, 'utf8'), '{broken');
  assert.equal((await store.reset('corrupt')).plan, null);
});

test('failed oversized writes preserve the old snapshot and release the lock', async t => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  const empty = await store.reset('large');
  const saved = await store.save('large', empty.revision, plan);
  await assert.rejects(store.save('large', saved.revision, { ...plan, requirements: Array(11).fill('x'.repeat(100_000)) }), code('PLAN_TOO_LARGE'));
  assert.deepEqual(await store.get('large'), saved);
  assert.equal((await readdir(directory)).length, 1);
  await store.save('large', saved.revision, plan);
});

test('storage defaults outside the project and accepts only absolute overrides', () => {
  assert.ok(dataDirectory({}).includes('matsu-artifact-workflow'));
  assert.equal(dataDirectory({ PLUGIN_DATA: join(process.cwd(), 'fixture') }), join(process.cwd(), 'fixture', 'task-memory'));
  assert.throws(() => dataDirectory({ ARTIFACT_WORKFLOW_DATA_DIR: './tasks' }), code('INVALID_DIRECTORY'));
});
