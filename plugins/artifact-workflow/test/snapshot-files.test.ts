import assert from 'node:assert/strict';
import fs, { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

import test from 'node:test';
import { SnapshotFiles } from '../mcp/src/snapshot-files.js';
import type { Session } from '../mcp/src/schema.js';
import { code, plan, session, temporaryDirectory } from './fixtures.js';

for (const operation of ['writeFile', 'sync', 'rename'] as const) {
  await test(`${operation} I/O failure preserves the snapshot and releases temporary files and the lock`, async (t) => {
    const directory = await temporaryDirectory(t);
    const files = new SnapshotFiles(directory);
    const saved = session;
    const filename = files.filename(saved.sessionId);
    const write = (value: Session) => files.withLock(filename, () => files.writeSnapshot(filename, value));
    await write(saved);
    const before = await readFile(filename);
    const failure = Object.assign(new Error(`Injected ${operation} failure`), { code: 'EIO' });
    let injected = false;
    if (operation === 'rename') {
      t.mock.method(fs, 'rename', async () => {
        injected = true;
        throw failure;
      });
    } else {
      const realOpen = fs.open;
      t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        const handle = await realOpen(...args);
        if (String(args[0]).endsWith('.tmp')) {
          t.mock.method(handle, operation, async () => {
            // 一時ファイルへ一部または全体を書いた後でも、失敗時に後始末されることを確認する。
            if (operation === 'writeFile') await handle.write('partial JSON');
            injected = true;
            throw failure;
          });
        }
        return handle;
      });
    }
    await assert.rejects(write({ ...saved, plan: { ...plan, request: 'updated' } }), (error) => error === failure);
    assert.equal(injected, true);
    t.mock.restoreAll();
    assert.deepEqual(await readFile(filename), before);
    assert.deepEqual(await files.readSnapshot(filename), saved);
    assert.equal((await readdir(directory)).length, 1);
    await write({ ...saved, plan: { ...plan, request: 'retried' } });
    assert.equal((await files.readSnapshot(filename))?.plan?.request, 'retried');
  });
}

await test('reads distinguish missing snapshots from corrupt, oversized, mismatched, or non-file data', async (t) => {
  const files = new SnapshotFiles(await temporaryDirectory(t));
  assert.equal(await files.readSnapshot(files.filename('missing')), null);
  const cases = [
    ['corrupt', '{broken'],
    ['mismatch', JSON.stringify(session)],
    ['oversized', 'x'.repeat(1024 * 1024 + 1)],
  ] as const;
  for (const [id, contents] of cases) {
    const filename = files.filename(id);
    await writeFile(filename, contents);
    await assert.rejects(files.readSnapshot(filename), code('INVALID_DATA'));
    assert.equal(await readFile(filename, 'utf8'), contents);
  }
  const directory = files.filename('directory');
  await mkdir(directory);
  await assert.rejects(files.readSnapshot(directory), code('INVALID_DATA'));
});

await test('a held lock is reported immediately and is never removed by a competing writer', async (t) => {
  const files = new SnapshotFiles(await temporaryDirectory(t));
  const filename = files.filename(session.sessionId);
  const lockPath = `${filename}.lock`;
  await writeFile(lockPath, 'existing writer');
  let invoked = false;
  await assert.rejects(
    files.withLock(filename, async () => {
      invoked = true;
    }),
    code('SESSION_BUSY'),
  );
  assert.equal(invoked, false);
  assert.equal(await readFile(lockPath, 'utf8'), 'existing writer');
});

await test('a non-conflict lock error propagates without running the action', async (t) => {
  const files = new SnapshotFiles(await temporaryDirectory(t));
  const failure = Object.assign(new Error('Cannot open lock'), { code: 'EACCES' });
  t.mock.method(fs, 'open', async () => {
    throw failure;
  });
  let invoked = false;
  await assert.rejects(
    files.withLock(files.filename(session.sessionId), async () => {
      invoked = true;
    }),
    (error) => error === failure,
  );
  assert.equal(invoked, false);
  assert.deepEqual(await readdir(files.directory), []);
});

await test('a failed locked action releases its lock and allows a later writer', async (t) => {
  const files = new SnapshotFiles(await temporaryDirectory(t));
  const filename = files.filename(session.sessionId);
  const failure = new Error('Action failed');
  await assert.rejects(
    files.withLock(filename, async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(await readdir(files.directory), []);
  assert.equal(await files.withLock(filename, async () => 'retried'), 'retried');
  assert.deepEqual(await readdir(files.directory), []);
});

await test('relative storage directories are rejected before touching the filesystem', () => {
  assert.throws(() => new SnapshotFiles('./tasks'), code('INVALID_DIRECTORY'));
});
