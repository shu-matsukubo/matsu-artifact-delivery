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
    initialize: async () => ({ ...session, plan: null }),
    reset: async () => ({ ...session, plan: null }),
    collectCompleted: async () => ({ deleted: 0, skipped: [] }),
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

await test('the six tools forward their inputs to a repository without filesystem dependencies', async (t) => {
  const store = repository();
  const calls = {
    get: t.mock.method(store, 'get'),
    initialize: t.mock.method(store, 'initialize'),
    reset: t.mock.method(store, 'reset'),
    collectCompleted: t.mock.method(store, 'collectCompleted'),
    save: t.mock.method(store, 'save'),
    complete: t.mock.method(store, 'complete'),
  };
  const client = await connect(t, store);
  const missing = await client.callTool({ name: 'get_plan', arguments: { sessionId: session.sessionId } });
  assert.deepEqual(missing.structuredContent, { session: null });
  assert.deepEqual(calls.get.mock.calls[0]?.arguments, [session.sessionId]);
  const initialized = await client.callTool({
    name: 'initialize_session',
    arguments: { sessionId: session.sessionId },
  });
  assert.deepEqual(calls.initialize.mock.calls[0]?.arguments, [session.sessionId]);
  const reset = await client.callTool({ name: 'reset_session', arguments: { sessionId: session.sessionId } });
  assert.deepEqual(calls.reset.mock.calls[0]?.arguments, [session.sessionId]);
  const collected = await client.callTool({ name: 'collect_completed_sessions', arguments: {} });
  assert.deepEqual(calls.collectCompleted.mock.calls[0]?.arguments, []);
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
  for (const result of [missing, initialized, reset, collected, saved, completed]) {
    assert.notEqual(result.isError, true);
    assert.deepEqual(textResult(result), result.structuredContent);
  }
});

await test('tool guidance, annotations, and exposed schema descriptions match their operation contracts', async (t) => {
  const client = await connect(t, repository());
  const tools = (await client.listTools()).tools;
  assert.deepEqual(
    tools.map(({ name }) => name),
    ['initialize_session', 'reset_session', 'collect_completed_sessions', 'save_plan', 'complete_session', 'get_plan'],
  );
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const tool of tools) assert.match(tool.description ?? '', /[\u3040-\u30ff\u4e00-\u9fff]/);
  assert.deepEqual(byName.get('initialize_session')?.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  });
  assert.deepEqual(byName.get('get_plan')?.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  for (const name of ['reset_session', 'collect_completed_sessions', 'save_plan', 'complete_session']) {
    assert.equal(byName.get(name)?.annotations?.readOnlyHint, false);
    assert.equal(byName.get(name)?.annotations?.destructiveHint, true);
    assert.match(byName.get(name)?.description ?? '', /親だけ/);
  }
  assert.match(byName.get('initialize_session')?.description ?? '', /親だけ.*別UUID/);
  assert.match(byName.get('reset_session')?.description ?? '', /明示的な許可/);
  assert.match(byName.get('collect_completed_sessions')?.description ?? '', /明示的な許可/);
  assert.match(byName.get('save_plan')?.description ?? '', /initialize_session.*get_plan/);
  const schemas = JSON.stringify(tools.map(({ inputSchema, outputSchema }) => ({ inputSchema, outputSchema })));
  assert.match(schemas, /この生成フロー固有のID/);
  assert.match(schemas, /会話履歴を含めないユーザーの依頼/);
});

await test('collection failures remain a successful collection response', async (t) => {
  const cleanup = { deleted: 1, skipped: [{ file: 'locked.json', code: 'SESSION_BUSY' }] };
  const store = repository({ collectCompleted: async () => cleanup });
  const client = await connect(t, store);
  const result = await client.callTool({ name: 'collect_completed_sessions', arguments: {} });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent, { cleanup });
});

for (const [code, guidance] of [
  ['NOT_INITIALIZED', /initialize_session/],
  ['REVISION_CONFLICT', /get_plan.*リセットしてはいけません/],
  ['SESSION_COMPLETED', /新しいタスク.*initialize_session/],
  ['SESSION_EXISTS', /新しいUUID.*同一フローの明確な続行/],
  ['PLAN_NOT_SAVED', /save_plan/],
  ['SESSION_BUSY', /書き込み中のプロセス.*ロックファイル/],
  ['INVALID_DATA', /推測・上書きせず保存データを確認.*対象計画の置換を明示的に許可/],
  ['PLAN_TOO_LARGE', /参照を保存.*1 MiB以内/],
  ['INVALID_DIRECTORY', /絶対パス/],
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
