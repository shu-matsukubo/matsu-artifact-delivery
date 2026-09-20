import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs, { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { PlanStore } from '../mcp/src/store.js';
import { code, plan, planAtSnapshotSize, snapshotPath, temporaryDirectory } from './fixtures.js';

await test('requires initialization, then round-trips the complete agreed plan through disk', async (t) => {
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

await test('reset discards the whole selected plan and preserves other active sessions', async (t) => {
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

await test('full writeback replaces removed tasks and fields; stale revisions cannot overwrite it', async (t) => {
  const store = new PlanStore(await temporaryDirectory(t));
  const { session: empty } = await store.reset('writeback');
  const first = await store.save('writeback', empty.revision, {
    ...plan,
    tasks: [...plan.tasks, { ...plan.tasks[0]!, id: 'T2', dependsOn: ['T1'] }],
  });
  const nextPlan = {
    ...plan,
    constraints: [],
    approval: { mode: 'waived', evidence: '今回の承認手続きを省略するという明示指示。' },
  };
  const next = await store.save('writeback', first.revision, nextPlan);
  assert.equal(next.plan?.tasks.length, 1);
  assert.deepEqual(next.plan?.constraints, []);
  await assert.rejects(store.save('writeback', first.revision, plan), code('REVISION_CONFLICT'));
  assert.deepEqual(await store.get('writeback'), next);
});

await test('invalid plans leave the previously approved snapshot intact', async (t) => {
  const store = new PlanStore(await temporaryDirectory(t));
  const { session: empty } = await store.reset('validation');
  const saved = await store.save('validation', empty.revision, plan);
  await assert.rejects(store.save('validation', saved.revision, { ...plan, conversation: '未確定な会話' }));
  assert.deepEqual(await store.get('validation'), saved);
});

await test('concurrent store instances cannot silently overwrite the same revision', async (t) => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  const { session: empty } = await store.reset('race');
  const results = await Promise.allSettled([
    store.save('race', empty.revision, { ...plan, request: 'A' }),
    new PlanStore(directory).save('race', empty.revision, { ...plan, request: 'B' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected');
  assert.ok(code('SESSION_BUSY')(rejected.reason) || code('REVISION_CONFLICT')(rejected.reason));
  assert.equal((await readdir(directory)).length, 1);
});

await test('IDs cannot escape storage and remain distinct on Windows', async (t) => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  for (const id of ['../outside', 'a/b', 'a\\b', '', 'a'.repeat(129)]) await assert.rejects(store.reset(id));
  for (const id of ['CON', 'session-A', 'session-a']) await store.reset(id);
  assert.equal((await readdir(directory)).length, 3);
  assert.equal((await store.get('session-A'))?.sessionId, 'session-A');
  assert.equal((await store.get('session-a'))?.sessionId, 'session-a');
});

await test('corrupt snapshots are reported, and only an explicit reset recovers them', async (t) => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  await store.reset('corrupt');
  const filename = join(directory, `${createHash('sha256').update('corrupt').digest('hex')}.json`);
  await writeFile(filename, '{broken');
  await assert.rejects(store.get('corrupt'), code('INVALID_DATA'));
  assert.equal(await readFile(filename, 'utf8'), '{broken');
  assert.equal((await store.reset('corrupt')).session.plan, null);
});

await test('failed oversized writes preserve the old snapshot and release the lock', async (t) => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  const { session: empty } = await store.reset('large');
  const saved = await store.save('large', empty.revision, plan);
  await assert.rejects(
    store.save('large', saved.revision, { ...plan, requirements: Array(11).fill('x'.repeat(100_000)) }),
    code('PLAN_TOO_LARGE'),
  );
  assert.deepEqual(await store.get('large'), saved);
  assert.equal((await readdir(directory)).length, 1);
  await store.save('large', saved.revision, plan);
});

await test('the largest accepted UTF-8 snapshot can complete and be collected after restart', async (t) => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  const { session: empty } = await store.reset('boundary');
  const filename = snapshotPath(directory, empty.sessionId);
  const maximum = 1024 * 1024;
  const completionGrowth = Buffer.byteLength(JSON.stringify(empty.updatedAt)) - Buffer.byteLength('null');
  const sized = planAtSnapshotSize(empty, maximum - completionGrowth);
  const saved = await store.save(empty.sessionId, empty.revision, sized);
  const before = await readFile(filename);
  assert.equal(before.length, maximum - completionGrowth);
  await assert.rejects(
    store.save(empty.sessionId, saved.revision, planAtSnapshotSize(saved, maximum - completionGrowth + 1)),
    code('PLAN_TOO_LARGE'),
  );
  assert.deepEqual(await readFile(filename), before);
  assert.equal((await readdir(directory)).length, 1);
  const completed = await new PlanStore(directory).complete(saved.sessionId, saved.revision);
  assert.equal((await readFile(filename)).length, maximum);
  assert.deepEqual(await new PlanStore(directory).get(saved.sessionId), completed);
  assert.deepEqual((await store.reset('next-flow')).cleanup, { deleted: 1, skipped: [] });
});

await test('completion requires the current agreed plan and seals it until a new flow starts', async (t) => {
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
  // 保存できない状況でも同じrevisionでの再実行は成功し、完了済みファイルを書き直さない。
  const rename = t.mock.method(fs, 'rename', async () => {
    throw new Error('Completed snapshot must not be rewritten');
  });
  assert.deepEqual(await store.complete('finish', completed.revision), completed);
  assert.equal(rename.mock.callCount(), 0);
  rename.mock.restore();
  await assert.rejects(store.save('finish', saved.revision, plan), code('REVISION_CONFLICT'));
  await assert.rejects(store.save('finish', completed.revision, plan), code('SESSION_COMPLETED'));

  // 完了済みの計画が残っていても、後日の修正は新しいタスクとして初期化する。
  const { session: correction } = await store.reset('finish');
  assert.equal(correction.completedAt, null);
  assert.equal(correction.plan, null);
  await assert.rejects(store.save('finish', completed.revision, plan), code('REVISION_CONFLICT'));
  const corrected = await store.save('finish', correction.revision, { ...plan, request: '既存の成果物を修正する' });
  assert.equal(corrected.plan?.request, '既存の成果物を修正する');
});
