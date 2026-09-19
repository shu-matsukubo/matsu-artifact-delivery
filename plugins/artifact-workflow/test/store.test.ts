import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { dataDirectory, PlanStore, StoreError } from '../mcp/src/store.js';
import type { Session } from '../mcp/src/schema.js';
import { plan, temporaryDirectory } from './fixtures.js';

const code = (expected: string) => (error: unknown) => error instanceof StoreError && error.code === expected;
const snapshotPath = (directory: string, id: string) => join(directory, `${createHash('sha256').update(id).digest('hex')}.json`);

test('requires initialization, then round-trips the complete agreed plan through disk', async t => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  assert.equal(await store.get('session-a'), null);
  await assert.rejects(store.save('session-a', randomUUID(), plan), code('NOT_INITIALIZED'));
  const { session: empty } = await store.reset('session-a');
  assert.equal(empty.plan, null);
  const saved = await store.save('session-a', empty.revision, plan);
  assert.deepEqual(saved.plan, plan);
  assert.notEqual(saved.revision, empty.revision);
  assert.deepEqual(await new PlanStore(directory).get('session-a'), saved);
  const [filename] = await readdir(directory);
  assert.ok(filename);
  assert.deepEqual(JSON.parse(await readFile(join(directory, filename), 'utf8')), saved);
});

test('reset discards the whole selected plan and preserves other active sessions', async t => {
  const store = new PlanStore(await temporaryDirectory(t));
  const { session: a } = await store.reset('session-a');
  const { session: b } = await store.reset('session-b');
  await store.save('session-a', a.revision, plan);
  const other = await store.save('session-b', b.revision, { ...plan, request: '別の依頼' });
  const { session: reset } = await store.reset('session-a');
  assert.equal(reset.plan, null);
  assert.deepEqual(await store.get('session-b'), other);
  await assert.rejects(store.save('session-a', a.revision, plan), code('REVISION_CONFLICT'));
});

test('full writeback replaces removed tasks and fields; stale revisions cannot overwrite it', async t => {
  const store = new PlanStore(await temporaryDirectory(t));
  const { session: empty } = await store.reset('writeback');
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
  const { session: empty } = await store.reset('validation');
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
  const { session: empty } = await store.reset('race');
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
  assert.equal((await store.reset('corrupt')).session.plan, null);
});

test('failed oversized writes preserve the old snapshot and release the lock', async t => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  const { session: empty } = await store.reset('large');
  const saved = await store.save('large', empty.revision, plan);
  await assert.rejects(store.save('large', saved.revision, { ...plan, requirements: Array(11).fill('x'.repeat(100_000)) }), code('PLAN_TOO_LARGE'));
  assert.deepEqual(await store.get('large'), saved);
  assert.equal((await readdir(directory)).length, 1);
  await store.save('large', saved.revision, plan);
});

test('completion requires the current agreed plan and seals it until a new flow starts', async t => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  await assert.rejects(store.complete('finish', randomUUID()), code('NOT_INITIALIZED'));
  const { session: empty } = await store.reset('finish');
  await assert.rejects(store.complete('finish', empty.revision), code('PLAN_NOT_SAVED'));
  const saved = await store.save('finish', empty.revision, plan);
  await assert.rejects(store.complete('finish', empty.revision), code('REVISION_CONFLICT'));
  assert.deepEqual(await store.get('finish'), saved);
  const completed = await store.complete('finish', saved.revision);
  assert.ok(completed.completedAt);
  assert.equal(completed.completedAt, completed.updatedAt);
  assert.notEqual(completed.revision, saved.revision);
  assert.deepEqual(completed.plan, saved.plan);
  assert.deepEqual(await new PlanStore(directory).get('finish'), completed);
  assert.deepEqual(await store.complete('finish', completed.revision), completed);
  await assert.rejects(store.save('finish', saved.revision, plan), code('REVISION_CONFLICT'));
  await assert.rejects(store.save('finish', completed.revision, plan), code('SESSION_COMPLETED'));

  // Even a still-present completed plan is replaced by a new correction task.
  const { session: correction } = await store.reset('finish');
  assert.equal(correction.completedAt, null);
  assert.equal(correction.plan, null);
  await assert.rejects(store.save('finish', completed.revision, plan), code('REVISION_CONFLICT'));
  const corrected = await store.save('finish', correction.revision, { ...plan, request: '既存の成果物を修正する' });
  assert.equal(corrected.plan?.request, '既存の成果物を修正する');
});

test('a new flow collects every completed session and preserves active, empty, and legacy snapshots', async t => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  const saved = new Map<string, Session>();
  for (const id of ['done-a', 'done-b', 'active', 'legacy']) {
    const { session } = await store.reset(id);
    saved.set(id, await store.save(id, session.revision, plan));
  }
  const { session: empty } = await store.reset('empty');
  const { completedAt: _completedAt, ...legacy } = saved.get('legacy')!;
  await writeFile(snapshotPath(directory, 'legacy'), JSON.stringify(legacy));
  for (const id of ['done-a', 'done-b']) await store.complete(id, saved.get(id)!.revision);

  // Reconnection alone leaves completed plans available.
  const restarted = new PlanStore(directory);
  assert.ok((await restarted.get('done-a'))?.completedAt);
  const result = await restarted.reset('new-flow');
  assert.deepEqual(result.cleanup, { deleted: 2, skipped: [] });
  for (const id of ['done-a', 'done-b']) assert.equal(await restarted.get(id), null);
  assert.deepEqual(await restarted.get('active'), saved.get('active'));
  assert.deepEqual(await restarted.get('empty'), empty);
  assert.deepEqual(await restarted.get('legacy'), { ...legacy, completedAt: null });
  assert.deepEqual(JSON.parse(await readFile(snapshotPath(directory, 'legacy'), 'utf8')), legacy);
  await assert.rejects(restarted.save('done-a', saved.get('done-a')!.revision, plan), code('NOT_INITIALIZED'));
  const { session: correction } = await restarted.reset('done-a');
  const corrected = await restarted.save('done-a', correction.revision, { ...plan, request: '削除済み計画の成果物を修正する' });
  assert.equal(corrected.plan?.request, '削除済み計画の成果物を修正する');
});

test('cleanup reports busy or invalid snapshots, ignores unrelated files, and retries on a later start', async t => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  const { session: empty } = await store.reset('busy');
  const saved = await store.save('busy', empty.revision, plan);
  const completed = await store.complete('busy', saved.revision);
  const busyLock = `${snapshotPath(directory, 'busy')}.lock`;
  await writeFile(busyLock, 'existing writer');
  const invalidFiles = [
    ['corrupt', '{broken'],
    ['mismatch', JSON.stringify(completed)],
    ['empty-completed', JSON.stringify({ ...completed, sessionId: 'empty-completed', plan: null })],
    ['oversized', 'x'.repeat(1024 * 1024 + 1)],
  ] as const;
  for (const [id, content] of invalidFiles) await writeFile(snapshotPath(directory, id), content);
  await mkdir(snapshotPath(directory, 'directory'));
  const unrelated = [
    ['notes.json', JSON.stringify(completed)],
    ['keep.tmp', 'temporary data'],
    ['orphan.lock', 'existing lock'],
  ] as const;
  for (const [file, content] of unrelated) await writeFile(join(directory, file), content);

  const result = await store.reset('new-flow');
  assert.equal(result.session.plan, null);
  assert.equal(result.cleanup.deleted, 0);
  assert.deepEqual(result.cleanup.skipped.map(item => item.code).sort(), [
    'INVALID_DATA', 'INVALID_DATA', 'INVALID_DATA', 'INVALID_DATA', 'INVALID_DATA', 'SESSION_BUSY',
  ]);
  assert.deepEqual(await store.get('busy'), completed);
  assert.equal(await readFile(busyLock, 'utf8'), 'existing writer');
  for (const [id, content] of invalidFiles) assert.equal(await readFile(snapshotPath(directory, id), 'utf8'), content);
  for (const [file, content] of unrelated) assert.equal(await readFile(join(directory, file), 'utf8'), content);

  await unlink(busyLock);
  assert.equal((await store.reset('later-flow')).cleanup.deleted, 1);
  assert.equal(await store.get('busy'), null);
});

test('cleanup preserves a session while another instance is completing it', { timeout: 10_000 }, async t => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  const writer = new PlanStore(directory);
  const { session: empty } = await store.reset('finishing');
  const saved = await store.save('finishing', empty.revision, plan);
  let entered!: () => void;
  let release!: () => void;
  const locked = new Promise<void>(resolve => { entered = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(writer, 'get', async (id: string) => {
    entered();
    await resume;
    return PlanStore.prototype.get.call(writer, id);
  });
  const pending = writer.complete('finishing', saved.revision);
  try {
    await Promise.race([locked, pending]);
    const result = await store.reset('another');
    assert.equal(result.cleanup.deleted, 0);
    assert.equal(result.cleanup.skipped[0]?.code, 'SESSION_BUSY');
    assert.deepEqual(await store.get('finishing'), saved);
  } finally { release(); await pending; }
  const completed = await pending;
  assert.ok(completed.completedAt);
  assert.equal((await store.reset('later')).cleanup.deleted, 1);
  assert.equal(await store.get('finishing'), null);
});

test('simultaneous starts preserve both new sessions and collect a completed snapshot once', async t => {
  const directory = await temporaryDirectory(t);
  const first = new PlanStore(directory);
  const second = new PlanStore(directory);
  const { session: empty } = await first.reset('done');
  const saved = await first.save('done', empty.revision, plan);
  await first.complete('done', saved.revision);
  const results = await Promise.all([first.reset('new-a'), second.reset('new-b')]);
  assert.equal(results.reduce((sum, result) => sum + result.cleanup.deleted, 0), 1);
  assert.equal(await first.get('done'), null);
  for (const result of results) assert.deepEqual(await first.get(result.session.sessionId), result.session);
  assert.equal((await readdir(directory)).length, 2);
});

test('storage defaults outside the project and accepts only absolute overrides', () => {
  assert.ok(dataDirectory({}).includes('matsu-artifact-workflow'));
  assert.equal(dataDirectory({ PLUGIN_DATA: join(process.cwd(), 'fixture') }), join(process.cwd(), 'fixture', 'task-memory'));
  assert.throws(() => dataDirectory({ ARTIFACT_WORKFLOW_DATA_DIR: './tasks' }), code('INVALID_DIRECTORY'));
});
