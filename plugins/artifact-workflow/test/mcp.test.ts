import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';
import { sessionSchema } from '../mcp/src/schema.js';
import { plan, planAtSnapshotSize, temporaryDirectory } from './fixtures.js';

const bundledServer = fileURLToPath(new URL('../../mcp/task-memory.cjs', import.meta.url));

async function connect(directory: string, entry = bundledServer) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: directory,
    env: { ...getDefaultEnvironment(), ARTIFACT_WORKFLOW_DATA_DIR: join(directory, 'data') },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const client = new Client({ name: 'task-memory-test', version: '1.0.0' });
  // Listing tools enables the SDK client's validation of every subsequent result.
  try {
    await client.connect(transport);
    await client.listTools();
  } catch (error) {
    await transport.close();
    throw new Error(`${String(error)}\n${stderr}`);
  }
  return client;
}

type Result = Awaited<ReturnType<Client['callTool']>>;
function snapshot(result: Result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return sessionSchema.parse((result.structuredContent as { session: unknown }).session);
}

await test(
  'shipped bundle works without node_modules, survives a process restart, and isolates sessions',
  { timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const directory = await temporaryDirectory(t, cleanup);
    const standalone = join(directory, 'standalone.cjs');
    await copyFile(bundledServer, standalone);
    let client = await connect(directory, standalone);
    cleanup.push(() => client.close());
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      'complete_session',
      'get_plan',
      'reset_session',
      'save_plan',
    ]);
    const empty = snapshot(await client.callTool({ name: 'reset_session', arguments: { sessionId: 'parent' } }));
    const saved = snapshot(
      await client.callTool({
        name: 'save_plan',
        arguments: { sessionId: 'parent', expectedRevision: empty.revision, plan },
      }),
    );
    await client.close();
    client = await connect(directory, standalone);
    assert.deepEqual(snapshot(await client.callTool({ name: 'get_plan', arguments: { sessionId: 'parent' } })), saved);
    await client.callTool({ name: 'reset_session', arguments: { sessionId: 'other' } });
    assert.deepEqual(snapshot(await client.callTool({ name: 'get_plan', arguments: { sessionId: 'parent' } })), saved);
    const invalid = await client.callTool({
      name: 'save_plan',
      arguments: {
        sessionId: 'parent',
        expectedRevision: saved.revision,
        plan: { ...plan, approval: { mode: 'pending', evidence: 'not agreed' } },
      },
    });
    assert.equal(invalid.isError, true);
    assert.deepEqual(snapshot(await client.callTool({ name: 'get_plan', arguments: { sessionId: 'parent' } })), saved);
    assert.equal(
      snapshot(await client.callTool({ name: 'reset_session', arguments: { sessionId: 'parent' } })).plan,
      null,
    );
    assert.deepEqual((await readdir(directory)).sort(), ['data', 'standalone.cjs']);
  },
);

await test(
  'a boundary-sized plan saved through the shipped MCP bundle can complete after restart',
  { timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const directory = await temporaryDirectory(t, cleanup);
    let client = await connect(directory);
    cleanup.push(() => client.close());
    const empty = snapshot(await client.callTool({ name: 'reset_session', arguments: { sessionId: 'boundary' } }));
    const growth = Buffer.byteLength(JSON.stringify(empty.updatedAt)) - Buffer.byteLength('null');
    const sized = planAtSnapshotSize(empty, 1024 * 1024 - growth);
    const saved = snapshot(
      await client.callTool({
        name: 'save_plan',
        arguments: { sessionId: empty.sessionId, expectedRevision: empty.revision, plan: sized },
      }),
    );
    const tooLarge = await client.callTool({
      name: 'save_plan',
      arguments: {
        sessionId: saved.sessionId,
        expectedRevision: saved.revision,
        plan: planAtSnapshotSize(saved, 1024 * 1024 - growth + 1),
      },
    });
    assert.equal(tooLarge.isError, true);
    await client.close();
    client = await connect(directory);
    const completed = snapshot(
      await client.callTool({
        name: 'complete_session',
        arguments: { sessionId: saved.sessionId, expectedRevision: saved.revision },
      }),
    );
    assert.ok(completed.completedAt);
    assert.deepEqual(completed.plan, sized);
    assert.deepEqual(
      snapshot(await client.callTool({ name: 'get_plan', arguments: { sessionId: saved.sessionId } })),
      completed,
    );
  },
);

await test(
  'completion survives MCP restart and a new flow deletes the plan before later correction work',
  { timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const directory = await temporaryDirectory(t, cleanup);
    let client = await connect(directory);
    cleanup.push(() => client.close());
    const active = snapshot(await client.callTool({ name: 'reset_session', arguments: { sessionId: 'active' } }));
    const empty = snapshot(await client.callTool({ name: 'reset_session', arguments: { sessionId: 'done' } }));
    const saved = snapshot(
      await client.callTool({
        name: 'save_plan',
        arguments: { sessionId: 'done', expectedRevision: empty.revision, plan },
      }),
    );
    const completed = snapshot(
      await client.callTool({
        name: 'complete_session',
        arguments: { sessionId: 'done', expectedRevision: saved.revision },
      }),
    );
    assert.ok(completed.completedAt);
    await client.close();
    client = await connect(directory);
    assert.deepEqual(
      snapshot(await client.callTool({ name: 'get_plan', arguments: { sessionId: 'done' } })),
      completed,
    );
    const rejected = await client.callTool({
      name: 'save_plan',
      arguments: { sessionId: 'done', expectedRevision: completed.revision, plan },
    });
    assert.equal(rejected.isError, true);
    const fresh = await client.callTool({ name: 'reset_session', arguments: { sessionId: 'new-flow' } });
    assert.equal(snapshot(fresh).completedAt, null);
    assert.deepEqual((fresh.structuredContent as { cleanup: unknown }).cleanup, { deleted: 1, skipped: [] });
    const missing = await client.callTool({ name: 'get_plan', arguments: { sessionId: 'done' } });
    assert.notEqual(missing.isError, true);
    assert.equal((missing.structuredContent as { session: unknown }).session, null);
    assert.deepEqual(snapshot(await client.callTool({ name: 'get_plan', arguments: { sessionId: 'active' } })), active);
    const correction = snapshot(await client.callTool({ name: 'reset_session', arguments: { sessionId: 'done' } }));
    const updated = snapshot(
      await client.callTool({
        name: 'save_plan',
        arguments: {
          sessionId: 'done',
          expectedRevision: correction.revision,
          plan: { ...plan, request: '後日の修正を新しいタスクとして計画する' },
        },
      }),
    );
    assert.equal(updated.plan?.request, '後日の修正を新しいタスクとして計画する');
    assert.equal(updated.completedAt, null);
  },
);

await test(
  'independent MCP processes detect competing writes and accept an explicit reconciled update',
  { timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const directory = await temporaryDirectory(t, cleanup);
    const first = await connect(directory);
    cleanup.push(() => first.close());
    const second = await connect(directory);
    cleanup.push(() => second.close());
    const empty = snapshot(await first.callTool({ name: 'reset_session', arguments: { sessionId: 'shared' } }));
    const results = await Promise.all(
      [first, second].map((client, index) =>
        client.callTool({
          name: 'save_plan',
          arguments: {
            sessionId: 'shared',
            expectedRevision: empty.revision,
            plan: { ...plan, request: `request-${index}` },
          },
        }),
      ),
    );
    assert.equal(results.filter((result) => result.isError !== true).length, 1);
    assert.equal(results.filter((result) => result.isError === true).length, 1);
    const current = snapshot(await second.callTool({ name: 'get_plan', arguments: { sessionId: 'shared' } }));
    const updated = snapshot(
      await second.callTool({
        name: 'save_plan',
        arguments: { sessionId: 'shared', expectedRevision: current.revision, plan },
      }),
    );
    assert.deepEqual(updated.plan, plan);
    assert.deepEqual(snapshot(await first.callTool({ name: 'get_plan', arguments: { sessionId: 'shared' } })), updated);
  },
);

await test(
  'advertised output schemas validate the session lifecycle and reject malformed results',
  { timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const client = await connect(await temporaryDirectory(t, cleanup));
    cleanup.push(() => client.close());
    const { tools } = await client.listTools();
    const provider = new AjvJsonSchemaValidator();
    const validators = new Map(
      tools.map((tool) => {
        assert.ok(tool.outputSchema, tool.name);
        const { $schema, ...schema } = tool.outputSchema;
        return [tool.name, provider.getValidator($schema === undefined ? schema : { ...schema, $schema })] as const;
      }),
    );
    const missing = await client.callTool({ name: 'get_plan', arguments: { sessionId: 'contract' } });
    assert.notEqual(missing.isError, true);
    assert.deepEqual(missing.structuredContent, { session: null });

    const reset = await client.callTool({ name: 'reset_session', arguments: { sessionId: 'contract' } });
    const empty = snapshot(reset);
    const save = await client.callTool({
      name: 'save_plan',
      arguments: { sessionId: 'contract', expectedRevision: empty.revision, plan },
    });
    const complete = await client.callTool({
      name: 'complete_session',
      arguments: { sessionId: 'contract', expectedRevision: snapshot(save).revision },
    });
    const completed = snapshot(complete);
    assert.ok(completed.completedAt);
    const get = await client.callTool({ name: 'get_plan', arguments: { sessionId: 'contract' } });
    assert.deepEqual(snapshot(get), completed);

    for (const [name, result] of Object.entries({
      reset_session: reset,
      save_plan: save,
      complete_session: complete,
      get_plan: get,
    })) {
      const validate = validators.get(name)!;
      const output = result.structuredContent as Record<string, unknown>;
      assert.equal(validate(output).valid, true, name);
      const text = result.content[0];
      assert.equal(text?.type, 'text');
      if (text?.type === 'text') assert.deepEqual(JSON.parse(text.text), output);
      assert.equal(validate({}).valid, false, name);
      assert.equal(validate({ ...output, session: null }).valid, name === 'get_plan', name);
      assert.equal(validate({ ...output, session: { ...completed, revision: 'invalid' } }).valid, false, name);
      assert.equal(validate({ ...output, session: { ...completed, completedAt: undefined } }).valid, false, name);
      assert.equal(
        validate({
          ...output,
          session: { ...completed, plan: { ...plan, approval: { mode: 'pending', evidence: 'unapproved' } } },
        }).valid,
        false,
        name,
      );
    }
    const validateReset = validators.get('reset_session')!;
    for (const invalidCleanup of [
      undefined,
      { deleted: -1, skipped: [] },
      { deleted: 0.5, skipped: [] },
      { deleted: '0', skipped: [] },
      { deleted: 0, skipped: [{ file: 'example.json' }] },
      { deleted: 0, skipped: [{ file: 'example.json', code: 123 }] },
    ]) {
      assert.equal(validateReset({ session: empty, cleanup: invalidCleanup }).valid, false);
    }
  },
);

await test('output validation preserves cleanup details and tool execution errors', { timeout: 30_000 }, async (t) => {
  const cleanup: Array<() => Promise<void>> = [];
  const directory = await temporaryDirectory(t, cleanup);
  const client = await connect(directory);
  cleanup.push(() => client.close());
  const empty = snapshot(await client.callTool({ name: 'reset_session', arguments: { sessionId: 'done' } }));
  const saved = snapshot(
    await client.callTool({
      name: 'save_plan',
      arguments: { sessionId: 'done', expectedRevision: empty.revision, plan },
    }),
  );
  await client.callTool({
    name: 'complete_session',
    arguments: { sessionId: 'done', expectedRevision: saved.revision },
  });
  const brokenFile = createHash('sha256').update('broken').digest('hex') + '.json';
  await writeFile(join(directory, 'data', brokenFile), '{ invalid JSON');
  const fresh = await client.callTool({ name: 'reset_session', arguments: { sessionId: 'fresh' } });
  const active = snapshot(fresh);
  assert.deepEqual((fresh.structuredContent as { cleanup: unknown }).cleanup, {
    deleted: 1,
    skipped: [{ file: brokenFile, code: 'INVALID_DATA' }],
  });
  const missing = await client.callTool({ name: 'get_plan', arguments: { sessionId: 'done' } });
  assert.notEqual(missing.isError, true);
  assert.deepEqual(missing.structuredContent, { session: null });

  const failed = await client.callTool({
    name: 'complete_session',
    arguments: { sessionId: 'fresh', expectedRevision: active.revision },
  });
  assert.equal(failed.isError, true);
  assert.equal(failed.structuredContent, undefined);
  const error = failed.content[0];
  assert.equal(error?.type, 'text');
  if (error?.type === 'text') assert.equal(JSON.parse(error.text).error, 'PLAN_NOT_SAVED');
  assert.deepEqual(snapshot(await client.callTool({ name: 'get_plan', arguments: { sessionId: 'fresh' } })), active);
});
