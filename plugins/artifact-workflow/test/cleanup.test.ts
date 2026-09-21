import assert from 'node:assert/strict';
import fs, { mkdir, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import test from 'node:test';
import { collectCompleted } from '../mcp/src/cleanup.js';
import { SnapshotFiles } from '../mcp/src/snapshot-files.js';
import { PlanStore } from '../mcp/src/store.js';
import type { Session } from '../mcp/src/schema.js';
import { code, plan, session, snapshotPath, temporaryDirectory } from './fixtures.js';

await test('a new flow collects every completed session and preserves active, empty, and legacy snapshots', async (t) => {
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

  // 再接続だけでは完了済みの計画を回収しない。
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
  const corrected = await restarted.save('done-a', correction.revision, {
    ...plan,
    request: '削除済み計画の成果物を修正する',
  });
  assert.equal(corrected.plan?.request, '削除済み計画の成果物を修正する');
});

await test('cleanup reports busy or invalid snapshots, ignores unrelated files, and retries on a later start', async (t) => {
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
  assert.deepEqual(result.cleanup.skipped.map((item) => item.code).sort(), [
    'INVALID_DATA',
    'INVALID_DATA',
    'INVALID_DATA',
    'INVALID_DATA',
    'INVALID_DATA',
    'SESSION_BUSY',
  ]);
  assert.deepEqual(await store.get('busy'), completed);
  assert.equal(await readFile(busyLock, 'utf8'), 'existing writer');
  for (const [id, content] of invalidFiles) assert.equal(await readFile(snapshotPath(directory, id), 'utf8'), content);
  for (const [file, content] of unrelated) assert.equal(await readFile(join(directory, file), 'utf8'), content);

  await unlink(busyLock);
  assert.equal((await store.reset('later-flow')).cleanup.deleted, 1);
  assert.equal(await store.get('busy'), null);
});

await test('cleanup preserves a session while another instance is completing it', { timeout: 10_000 }, async (t) => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  const writer = new PlanStore(directory);
  const { session: empty } = await store.reset('finishing');
  const saved = await store.save('finishing', empty.revision, plan);
  let entered!: () => void;
  let release!: () => void;
  const locked = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
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
  } finally {
    release();
    await pending;
  }
  const completed = await pending;
  assert.ok(completed.completedAt);
  assert.equal((await store.reset('later')).cleanup.deleted, 1);
  assert.equal(await store.get('finishing'), null);
});

await test('simultaneous starts preserve both new sessions and collect a completed snapshot once', async (t) => {
  const directory = await temporaryDirectory(t);
  const first = new PlanStore(directory);
  const second = new PlanStore(directory);
  const { session: empty } = await first.reset('done');
  const saved = await first.save('done', empty.revision, plan);
  await first.complete('done', saved.revision);
  const results = await Promise.all([first.reset('new-a'), second.reset('new-b')]);
  assert.equal(
    results.reduce((sum, result) => sum + result.cleanup.deleted, 0),
    1,
  );
  assert.equal(await first.get('done'), null);
  for (const result of results) assert.deepEqual(await first.get(result.session.sessionId), result.session);
  assert.equal((await readdir(directory)).length, 2);
});

await test('directory enumeration failure is reported without undoing a successful reset', async (t) => {
  const directory = await temporaryDirectory(t);
  const store = new PlanStore(directory);
  t.mock.method(fs, 'readdir', async () => {
    throw Object.assign(new Error('Cannot list'), { code: 'EACCES' });
  });
  const result = await store.reset('new-flow');
  assert.deepEqual(result.cleanup, { deleted: 0, skipped: [{ file: '.', code: 'EACCES' }] });
  assert.deepEqual(await store.get('new-flow'), result.session);
});

for (const [failure, expectedCode] of [
  [Object.assign(new Error('Cannot delete'), { code: 'EACCES' }), 'EACCES'],
  [new Error('Unknown deletion failure'), 'CLEANUP_FAILED'],
] as const) {
  await test(`cleanup records ${expectedCode}, continues with other files, and retries later`, async (t) => {
    const directory = await temporaryDirectory(t);
    const files = new SnapshotFiles(directory);
    const failedFilename = files.filename('failed');
    const otherFilename = files.filename('other');
    for (const id of ['failed', 'other']) {
      const filename = files.filename(id);
      await files.withLock(filename, () =>
        files.writeSnapshot(filename, {
          ...session,
          sessionId: id,
          completedAt: session.updatedAt,
        }),
      );
    }
    const realUnlink = fs.unlink;
    t.mock.method(fs, 'unlink', async (path: Parameters<typeof fs.unlink>[0]) => {
      if (path === failedFilename) throw failure;
      await realUnlink(path);
    });
    assert.deepEqual(await collectCompleted(files, files.filename('current')), {
      deleted: 1,
      skipped: [{ file: basename(failedFilename), code: expectedCode }],
    });
    assert.ok((await files.readSnapshot(failedFilename))?.completedAt);
    assert.equal(await files.readSnapshot(otherFilename), null);
    t.mock.restoreAll();
    assert.deepEqual(await collectCompleted(files, files.filename('current')), { deleted: 1, skipped: [] });
    assert.equal(await files.readSnapshot(failedFilename), null);
  });
}
