import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StoreError } from '../mcp/src/errors.js';
import type { PlanRepository } from '../mcp/src/repository.js';
import { createServer } from '../mcp/src/server.js';
import { plan, session } from './fixtures.js';

function repository(overrides: Partial<PlanRepository> = {}): PlanRepository {
  return {
    get: async () => null,
    reset: async () => ({ session: { ...session, plan: null }, cleanup: { deleted: 0, skipped: [] } }),
    save: async () => session,
    complete: async () => ({ ...session, completedAt: session.updatedAt }),
    ...overrides,
  };
}

/** 実際のMCP入力・出力検証を通し、保存先や子プロセスに依存せず応答契約を確認する。 */
async function connect(t: TestContext, store: PlanRepository): Promise<Client> {
  const server = createServer(store);
  const client = new Client({ name: 'server-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => {
    await client.close();
    await server.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.listTools();
  return client;
}

type Result = Awaited<ReturnType<Client['callTool']>>;
function textResult(result: Result): Record<string, unknown> {
  const content = result.content[0];
  assert.equal(content?.type, 'text');
  if (content?.type !== 'text') throw new Error('Missing text result.');
  return JSON.parse(content.text) as Record<string, unknown>;
}

await test('the four tools forward their inputs to a repository without filesystem dependencies', async (t) => {
  const store = repository();
  const calls = {
    get: t.mock.method(store, 'get'),
    reset: t.mock.method(store, 'reset'),
    save: t.mock.method(store, 'save'),
    complete: t.mock.method(store, 'complete'),
  };
  const client = await connect(t, store);
  const missing = await client.callTool({ name: 'get_plan', arguments: { sessionId: session.sessionId } });
  assert.deepEqual(missing.structuredContent, { session: null });
  assert.deepEqual(calls.get.mock.calls[0]?.arguments, [session.sessionId]);
  const reset = await client.callTool({ name: 'reset_session', arguments: { sessionId: session.sessionId } });
  assert.deepEqual(calls.reset.mock.calls[0]?.arguments, [session.sessionId]);
  const saved = await client.callTool({
    name: 'save_plan',
    arguments: { sessionId: session.sessionId, expectedRevision: session.revision, plan },
  });
  assert.deepEqual(calls.save.mock.calls[0]?.arguments, [session.sessionId, session.revision, plan]);
  assert.deepEqual(saved.structuredContent, { session });
  const completed = await client.callTool({
    name: 'complete_session',
    arguments: { sessionId: session.sessionId, expectedRevision: session.revision },
  });
  assert.deepEqual(calls.complete.mock.calls[0]?.arguments, [session.sessionId, session.revision]);
  assert.deepEqual(completed.structuredContent, { session: { ...session, completedAt: session.updatedAt } });
  for (const result of [missing, reset, saved, completed]) {
    assert.notEqual(result.isError, true);
    assert.deepEqual(textResult(result), result.structuredContent);
  }
});

await test('cleanup failures remain a successful reset response', async (t) => {
  const cleanup = { deleted: 1, skipped: [{ file: 'locked.json', code: 'SESSION_BUSY' }] };
  const store = repository({ reset: async () => ({ session: { ...session, plan: null }, cleanup }) });
  const client = await connect(t, store);
  const result = await client.callTool({ name: 'reset_session', arguments: { sessionId: session.sessionId } });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent, { session: { ...session, plan: null }, cleanup });
});

for (const [code, guidance] of [
  ['NOT_INITIALIZED', /reset_session/],
  ['REVISION_CONFLICT', /get_plan.*Never reset/],
  ['SESSION_COMPLETED', /new task.*reset_session/],
  ['PLAN_NOT_SAVED', /save_plan/],
  ['SESSION_BUSY', /confirm no writer remains.*reported lock file/],
  ['INVALID_DATA', /Do not infer or overwrite.*inspect/],
  ['PLAN_TOO_LARGE', /references.*completion metadata/],
  ['INVALID_DIRECTORY', /absolute path/],
] as const) {
  await test(`MCP adds operation guidance to ${code} without changing the stored failure reason`, async (t) => {
    const failure = new StoreError(code, `Failure reason: ${code}.`);
    const client = await connect(
      t,
      repository({
        save: async () => {
          throw failure;
        },
      }),
    );
    const result = await client.callTool({
      name: 'save_plan',
      arguments: { sessionId: session.sessionId, expectedRevision: session.revision, plan },
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    const body = textResult(result);
    assert.equal(body.error, code);
    assert.equal(typeof body.message, 'string');
    assert.ok(String(body.message).startsWith(failure.message));
    assert.match(String(body.message), guidance);
    assert.equal(failure.message, `Failure reason: ${code}.`);
  });
}

await test('OS codes and unknown failures retain the generic MCP error contract', async (t) => {
  for (const failure of [Object.assign(new Error('Disk failure'), { code: 'EIO' }), 'unknown failure']) {
    const client = await connect(
      t,
      repository({
        get: async () => {
          throw failure;
        },
      }),
    );
    const result = await client.callTool({ name: 'get_plan', arguments: { sessionId: session.sessionId } });
    assert.equal(result.isError, true);
    assert.deepEqual(textResult(result), {
      error: 'STORE_ERROR',
      message: failure instanceof Error ? 'Disk failure' : 'Unable to access the plan store.',
    });
  }
});
