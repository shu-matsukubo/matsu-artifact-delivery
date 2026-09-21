import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_SNAPSHOT_BYTES, parseSnapshot, serializeSnapshot } from '../mcp/src/snapshot.js';
import { code, planAtSnapshotSize, session } from './fixtures.js';

await test('snapshot JSON round-trips with its existing formatting', () => {
  const json = serializeSnapshot(session);
  assert.equal(json, `${JSON.stringify(session, null, 2)}\n`);
  assert.deepEqual(parseSnapshot(json), session);
});

await test('legacy snapshots without completion metadata remain active', () => {
  const { completedAt: _completedAt, ...legacy } = session;
  assert.deepEqual(parseSnapshot(JSON.stringify(legacy)), session);
});

await test('malformed JSON, invalid schemas, and completed snapshots without plans are rejected', () => {
  for (const raw of [
    '{broken',
    'null',
    JSON.stringify({ ...session, schemaVersion: 2 }),
    JSON.stringify({ ...session, revision: 'invalid' }),
    JSON.stringify({ ...session, completedAt: session.updatedAt, plan: null }),
    JSON.stringify({ ...session, plan: { ...session.plan, conversation: 'unapproved' } }),
  ]) {
    assert.throws(() => parseSnapshot(raw), code('INVALID_DATA'));
  }
});

await test('UTF-8 size accounting reserves exactly enough room to complete an accepted plan', () => {
  const growth = Buffer.byteLength(JSON.stringify(session.updatedAt)) - Buffer.byteLength('null');
  const active = { ...session, plan: planAtSnapshotSize(session, MAX_SNAPSHOT_BYTES - growth) };
  const serialized = serializeSnapshot(active);
  assert.equal(Buffer.byteLength(serialized), MAX_SNAPSHOT_BYTES - growth);
  assert.deepEqual(parseSnapshot(serialized), active);
  const completed = { ...active, completedAt: active.updatedAt };
  const completedJson = serializeSnapshot(completed);
  assert.equal(Buffer.byteLength(completedJson), MAX_SNAPSHOT_BYTES);
  assert.deepEqual(parseSnapshot(completedJson), completed);
  assert.throws(
    () =>
      serializeSnapshot({
        ...active,
        plan: planAtSnapshotSize(session, MAX_SNAPSHOT_BYTES - growth + 1),
      }),
    code('PLAN_TOO_LARGE'),
  );
});

await test('the parser rejects oversized bytes even when they are otherwise valid JSON', () => {
  const raw = JSON.stringify(session).padEnd(MAX_SNAPSHOT_BYTES + 1);
  assert.throws(() => parseSnapshot(raw), code('INVALID_DATA'));
});
