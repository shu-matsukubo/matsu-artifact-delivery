import assert from 'node:assert/strict';
import test from 'node:test';
import { completeSession, createSession, replacePlan, type SessionChange } from '../mcp/src/session.js';
import { code, plan, session } from './fixtures.js';

const change: SessionChange = {
  revision: '22222222-2222-4222-8222-222222222222',
  updatedAt: '2026-09-20T02:00:00.000Z',
};

await test('initialization creates a new empty session using the supplied metadata', () => {
  assert.deepEqual(createSession('new-flow', change), {
    schemaVersion: 1,
    sessionId: 'new-flow',
    revision: change.revision,
    createdAt: change.updatedAt,
    updatedAt: change.updatedAt,
    completedAt: null,
    plan: null,
  });
});

await test('replacement removes old tasks and fields without mutating either input', () => {
  const current = {
    ...session,
    plan: { ...plan, tasks: [...plan.tasks, { ...plan.tasks[0]!, id: 'T2', dependsOn: ['T1'] }] },
  };
  const replacement = { ...plan, constraints: [], request: '更新した依頼' };
  const before = structuredClone({ current, replacement });
  const next = replacePlan(current, current.revision, replacement, change);
  assert.deepEqual(next, { ...current, ...change, plan: replacement });
  assert.equal(next.plan?.tasks.length, 1);
  assert.deepEqual(next.plan?.constraints, []);
  assert.deepEqual({ current, replacement }, before);
});

await test('replacement rejects missing, stale, and completed sessions in that order', () => {
  assert.throws(() => replacePlan(null, session.revision, plan, change), code('NOT_INITIALIZED'));
  assert.throws(() => replacePlan(session, change.revision, plan, change), code('REVISION_CONFLICT'));
  const completed = { ...session, completedAt: session.updatedAt };
  assert.throws(() => replacePlan(completed, change.revision, plan, change), code('REVISION_CONFLICT'));
  assert.throws(() => replacePlan(completed, session.revision, plan, change), code('SESSION_COMPLETED'));
});

await test('completion requires initialization, the current revision, and an agreed plan', () => {
  assert.throws(() => completeSession(null, session.revision, change), code('NOT_INITIALIZED'));
  const empty = { ...session, plan: null };
  assert.throws(() => completeSession(empty, change.revision, change), code('REVISION_CONFLICT'));
  assert.throws(() => completeSession(empty, empty.revision, change), code('PLAN_NOT_SAVED'));
});

await test('completion changes metadata once and only accepts retries with the completed revision', () => {
  const before = structuredClone(session);
  const completed = completeSession(session, session.revision, change);
  assert.deepEqual(completed, { ...session, ...change, completedAt: change.updatedAt });
  assert.deepEqual(session, before);
  const later = { revision: session.revision, updatedAt: '2026-09-21T00:00:00.000Z' };
  assert.equal(completeSession(completed, completed.revision, later), completed);
  assert.throws(() => completeSession(completed, session.revision, later), code('REVISION_CONFLICT'));
});
