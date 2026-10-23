import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';
import { sessionSchema } from '../mcp/src/schema.js';
import { plan, planAtSnapshotSize, temporaryDirectory } from './fixtures.js';

const bundledServer = fileURLToPath(new URL('../../mcp/task-memory.cjs', import.meta.url));
const windowsLauncher = fileURLToPath(new URL('../../mcp/start.ps1', import.meta.url));

async function connect(
  directory: string,
  entry = bundledServer,
  manifestEnvironment = false,
  pluginData?: string,
  extensionsDirectory?: string,
) {
  const inheritedEnvironment = getDefaultEnvironment();
  if (process.platform === 'win32') delete inheritedEnvironment.PATHEXT;
  const command = process.platform === 'win32' ? 'powershell.exe' : process.execPath;
  const args =
    process.platform === 'win32'
      ? [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          windowsLauncher,
          ...(entry === bundledServer ? [] : ['-Entry', entry]),
        ]
      : [entry];
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...inheritedEnvironment,
    ARTIFACT_WORKFLOW_DATA_DIR: join(directory, 'data'),
    ARTIFACT_WORKFLOW_EXTENSIONS_DIR: extensionsDirectory ?? join(directory, 'extensions'),
    ...(process.platform === 'win32'
      ? {
          ARTIFACT_WORKFLOW_RUNTIME_DIR: join(directory, 'runtime'),
          PATH: (process.env.PATH ?? '')
            .split(';')
            .filter(
              (path) =>
                path
                  .replaceAll('/', '\\')
                  .replace(/[\\]+$/, '')
                  .toLowerCase() !==
                process.execPath
                  .slice(0, -'node.exe'.length)
                  .replace(/[\\]+$/, '')
                  .toLowerCase(),
            )
            .join(';'),
        }
      : {}),
  };
  if (process.platform === 'win32' && manifestEnvironment) {
    environment.LOCALAPPDATA = undefined;
    environment.ARTIFACT_WORKFLOW_RUNTIME_DIR = undefined;
    environment.PLUGIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));
    environment.PLUGIN_DATA = pluginData ?? join(directory, 'plugin-data');
    environment.ARTIFACT_WORKFLOW_DATA_DIR = join(environment.PLUGIN_DATA, 'task-memory');
    environment.ARTIFACT_WORKFLOW_EXTENSIONS_DIR = join(environment.PLUGIN_DATA, 'extensions');
    const sdkEnvironment = { ...getDefaultEnvironment(), ...environment };
    assert.equal(sdkEnvironment.LOCALAPPDATA, undefined);
    assert.equal(sdkEnvironment.ARTIFACT_WORKFLOW_RUNTIME_DIR, undefined);
  }
  if (process.platform === 'win32') Reflect.deleteProperty(environment, 'PATHEXT');
  const transport = new StdioClientTransport({
    command,
    args,
    cwd: directory,
    env: environment as Record<string, string>,
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
      'collect_completed_sessions',
      'complete_session',
      'delete_extension',
      'get_extension',
      'get_plan',
      'initialize_session',
      'list_extensions',
      'register_extension',
      'reset_session',
      'save_plan',
      'update_extension',
    ]);
    const empty = snapshot(await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'parent' } }));
    const saved = snapshot(
      await client.callTool({
        name: 'save_plan',
        arguments: { sessionId: 'parent', expectedRevision: empty.revision, plan },
      }),
    );
    await client.close();
    client = await connect(directory, standalone);
    assert.deepEqual(snapshot(await client.callTool({ name: 'get_plan', arguments: { sessionId: 'parent' } })), saved);
    const other = snapshot(await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'other' } }));
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
    const reset = await client.callTool({ name: 'reset_session', arguments: { sessionId: 'parent' } });
    assert.equal(snapshot(reset).plan, null);
    assert.deepEqual(snapshot(await client.callTool({ name: 'get_plan', arguments: { sessionId: 'other' } })), other);
    assert.deepEqual((await readdir(directory)).sort(), [
      'data',
      ...(process.platform === 'win32' ? ['runtime'] : []),
      'standalone.cjs',
    ]);
  },
);

await test(
  'an invalid extension directory does not block mandatory plan-memory tools',
  { timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const directory = await temporaryDirectory(t, cleanup);
    const client = await connect(directory, bundledServer, false, undefined, 'relative/extensions');
    cleanup.push(() => client.close());
    const planSession = await client.callTool({
      name: 'initialize_session',
      arguments: { sessionId: 'plan-store-available' },
    });
    assert.notEqual(planSession.isError, true, JSON.stringify(planSession));
    const extensionList = await client.callTool({ name: 'list_extensions', arguments: {} });
    assert.equal(extensionList.isError, true);
  },
);

await test(
  'extension CRUD uses stdio and survives restart plus completed-plan collection',
  { timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const directory = await temporaryDirectory(t, cleanup);
    let client = await connect(directory);
    cleanup.push(() => client.close());
    const emptyList = await client.callTool({ name: 'list_extensions', arguments: {} });
    assert.deepEqual(emptyList.structuredContent, { extensions: [] });
    const generation = {
      id: 'registered-generation',
      name: 'Generation rule',
      type: 'generation',
      target: 'text report',
      applicability: 'a report is requested from supplied data',
      summary: 'Preserve the supplied values.',
      instructions: 'Use only the supplied values. Do not add new sections.',
      dependencies: [],
    };
    const marker = join(directory, 'must-not-be-created');
    const review = {
      id: 'registered-review',
      name: 'Review rule',
      type: 'review',
      target: 'text report',
      applicability: 'reviewing a generated report',
      summary: 'Review links and claims.',
      instructions: `Read only. Do not execute: ${process.execPath} -e "require('fs').writeFileSync('${marker}', 'executed')"`,
      dependencies: [
        'Skill: optional-review-skill',
        `command: ${process.execPath} -e "console.log('registered-only')"`,
      ],
    };
    const created = await client.callTool({ name: 'register_extension', arguments: generation });
    assert.notEqual(created.isError, true, JSON.stringify(created));
    const generationRecord = (created.structuredContent as { extension: { revision: string } }).extension;
    const createdReview = await client.callTool({ name: 'register_extension', arguments: review });
    assert.notEqual(createdReview.isError, true, JSON.stringify(createdReview));
    const reviewRecord = (
      createdReview.structuredContent as {
        extension: { revision: string; instructions: string; dependencies: string[] };
      }
    ).extension;
    assert.ok(reviewRecord.instructions.includes(marker));
    assert.equal(reviewRecord.dependencies.length, 2);
    const reviews = await client.callTool({ name: 'list_extensions', arguments: { type: 'review' } });
    assert.equal((reviews.structuredContent as { extensions: unknown[] }).extensions.length, 1);
    const update = await client.callTool({
      name: 'update_extension',
      arguments: {
        id: generation.id,
        expectedRevision: generationRecord.revision,
        extension: { ...generation, summary: 'Updated summary.' },
      },
    });
    assert.notEqual(update.isError, true, JSON.stringify(update));
    const updated = (update.structuredContent as { extension: { revision: string } }).extension;
    const conflict = await client.callTool({
      name: 'update_extension',
      arguments: { id: generation.id, expectedRevision: generationRecord.revision, extension: generation },
    });
    assert.equal(conflict.isError, true);
    assert.equal(
      (await client.callTool({ name: 'register_extension', arguments: { ...generation, type: 'invalid' } })).isError,
      true,
    );
    assert.equal((await client.callTool({ name: 'register_extension', arguments: generation })).isError, true);
    const initialized = snapshot(
      await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'extensions-cleanup' } }),
    );
    const saved = snapshot(
      await client.callTool({
        name: 'save_plan',
        arguments: { sessionId: initialized.sessionId, expectedRevision: initialized.revision, plan },
      }),
    );
    await client.callTool({
      name: 'complete_session',
      arguments: { sessionId: saved.sessionId, expectedRevision: saved.revision },
    });
    const collected = await client.callTool({ name: 'collect_completed_sessions', arguments: {} });
    assert.deepEqual((collected.structuredContent as { cleanup: unknown }).cleanup, { deleted: 1, skipped: [] });
    assert.equal(
      await stat(marker).then(
        () => true,
        () => false,
      ),
      false,
    );
    await client.close();
    client = await connect(directory);
    cleanup.push(() => client.close());
    const persisted = await client.callTool({ name: 'get_extension', arguments: { id: review.id } });
    assert.deepEqual((persisted.structuredContent as { extension: unknown }).extension, reviewRecord);
    const deletion = await client.callTool({
      name: 'delete_extension',
      arguments: { id: generation.id, expectedRevision: updated.revision },
    });
    assert.deepEqual(deletion.structuredContent, { deleted: true });
    await client.close();
    await mkdir(join(directory, 'data'), { recursive: true });
    await mkdir(join(directory, 'extensions'), { recursive: true });
    await writeFile(join(directory, 'extensions', 'extensions.json'), '{invalid');
    client = await connect(directory);
    assert.deepEqual(
      (await client.callTool({ name: 'get_plan', arguments: { sessionId: 'unrelated' } })).structuredContent,
      { session: null },
    );
    const failedRegistry = await client.callTool({ name: 'list_extensions', arguments: {} });
    assert.equal(failedRegistry.isError, true);
  },
);

await test(
  'starts from a long PLUGIN_DATA path and keeps session data there across restart',
  { skip: process.platform !== 'win32', timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const directory = await temporaryDirectory(t, cleanup);
    const base = join(directory, 'plugin-data');
    const targetLength = 192;
    const suffixLength = targetLength - base.length - 1;
    const suffix = `${'日本語 path '.repeat(Math.ceil((suffixLength - 1) / 8)).slice(0, suffixLength - 1)}X`;
    const pluginData = join(base, suffix);
    const archive = await readFile(fileURLToPath(new URL('../../mcp/node-win-x64.zip', import.meta.url)));
    const runtime = createHash('sha256').update(archive).digest('hex');
    const nodePath = join(pluginData, 'runtime', runtime, 'node.exe');
    assert.ok(pluginData.length < 260, `PLUGIN_DATA length: ${pluginData.length}`);
    assert.ok(nodePath.length > 260, `node.exe path length: ${nodePath.length}`);
    t.diagnostic(`PLUGIN_DATA path length ${pluginData.length}; node.exe path length ${nodePath.length}`);
    const otherPluginData = join(pluginData, 'other-plugin');
    await mkdir(otherPluginData, { recursive: true });
    await writeFile(join(otherPluginData, 'settings.json'), '{"preserve":true}\n');
    const client = await connect(directory, bundledServer, true, pluginData);
    cleanup.push(() => client.close());
    const initialized = snapshot(
      await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'long-path' } }),
    );
    const saved = snapshot(
      await client.callTool({
        name: 'save_plan',
        arguments: { sessionId: 'long-path', expectedRevision: initialized.revision, plan },
      }),
    );
    await client.close();
    const restarted = await connect(directory, bundledServer, true, pluginData);
    cleanup.push(() => restarted.close());
    assert.deepEqual(
      snapshot(await restarted.callTool({ name: 'get_plan', arguments: { sessionId: 'long-path' } })),
      saved,
    );
    assert.equal(await readFile(join(otherPluginData, 'settings.json'), 'utf8'), '{"preserve":true}\n');
    assert.ok((await readdir(join(pluginData, 'runtime', runtime))).includes('node.exe'));
  },
);

await test(
  'native Windows launch preserves child standard streams and exit code',
  { skip: process.platform !== 'win32', timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const directory = await temporaryDirectory(t, cleanup);
    const entry = join(directory, 'exit-check.cjs');
    await writeFile(
      entry,
      "process.stdout.write('stdout-marker\\n'); process.stderr.write('stderr-marker\\n'); process.exit(37);\n",
    );
    const environment = {
      ...process.env,
      PLUGIN_DATA: join(directory, 'plugin-data'),
      ARTIFACT_WORKFLOW_RUNTIME_DIR: join(directory, 'runtime'),
      ARTIFACT_WORKFLOW_DATA_DIR: join(directory, 'data'),
    };
    Reflect.deleteProperty(environment, 'PATHEXT');
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', windowsLauncher, '-Entry', entry],
      { cwd: directory, env: environment, encoding: 'utf8', timeout: 30_000, windowsHide: true },
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 37, result.stderr);
    assert.match(result.stdout, /stdout-marker/);
    assert.match(result.stderr, /stderr-marker/);
  },
);

await test(
  'starts from manifest-provided directories without ambient Windows runtime paths',
  { skip: process.platform !== 'win32', timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const directory = await temporaryDirectory(t, cleanup);
    const client = await connect(directory, bundledServer, true);
    cleanup.push(() => client.close());
    assert.ok((await client.listTools()).tools.length > 0);
    assert.ok((await readdir(join(directory, 'plugin-data', 'runtime'))).length > 0);
    assert.deepEqual(
      (await client.callTool({ name: 'get_plan', arguments: { sessionId: 'manifest' } })).structuredContent,
      {
        session: null,
      },
    );
  },
);

await test(
  'repairs an incomplete cached Windows runtime before launching MCP',
  { skip: process.platform !== 'win32', timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const directory = await temporaryDirectory(t, cleanup);
    const archive = await readFile(fileURLToPath(new URL('../../mcp/node-win-x64.zip', import.meta.url)));
    const runtime = createHash('sha256').update(archive).digest('hex');
    await mkdir(join(directory, 'runtime', runtime), { recursive: true });
    const [repaired, concurrent] = await Promise.all([connect(directory), connect(directory)]);
    cleanup.push(
      () => repaired.close(),
      () => concurrent.close(),
    );
    assert.ok((await repaired.listTools()).tools.length > 0);
    assert.ok((await concurrent.listTools()).tools.length > 0);
  },
);

await test(
  'replaces a damaged cached Windows node.exe before launching MCP',
  { skip: process.platform !== 'win32', timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const directory = await temporaryDirectory(t, cleanup);
    const archive = await readFile(fileURLToPath(new URL('../../mcp/node-win-x64.zip', import.meta.url)));
    const runtime = createHash('sha256').update(archive).digest('hex');
    const cachedNode = join(directory, 'runtime', runtime, 'node.exe');
    await mkdir(join(directory, 'runtime', runtime), { recursive: true });
    await writeFile(cachedNode, 'truncated executable');
    const client = await connect(directory);
    cleanup.push(() => client.close());
    assert.ok((await client.listTools()).tools.length > 0);
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
    const empty = snapshot(await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'boundary' } }));
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
  'initialization preserves existing sessions and completed-session collection is a separate operation',
  { timeout: 30_000 },
  async (t) => {
    const cleanup: Array<() => Promise<void>> = [];
    const directory = await temporaryDirectory(t, cleanup);
    let client = await connect(directory);
    cleanup.push(() => client.close());
    const activeEmpty = snapshot(
      await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'active' } }),
    );
    const active = snapshot(
      await client.callTool({
        name: 'save_plan',
        arguments: { sessionId: 'active', expectedRevision: activeEmpty.revision, plan },
      }),
    );
    const empty = snapshot(await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'done' } }));
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
    const rejected = await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'done' } });
    assert.equal(rejected.isError, true);
    assert.equal(JSON.parse((rejected.content[0] as { text: string }).text).error, 'SESSION_EXISTS');
    const rejectedActive = await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'active' } });
    assert.equal(rejectedActive.isError, true);
    const fresh = snapshot(await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'new-flow' } }));
    assert.equal(fresh.completedAt, null);
    assert.deepEqual(
      snapshot(await client.callTool({ name: 'get_plan', arguments: { sessionId: 'done' } })),
      completed,
    );
    assert.deepEqual(snapshot(await client.callTool({ name: 'get_plan', arguments: { sessionId: 'active' } })), active);
    const collection = await client.callTool({ name: 'collect_completed_sessions', arguments: {} });
    assert.deepEqual((collection.structuredContent as { cleanup: unknown }).cleanup, { deleted: 1, skipped: [] });
    const collected = await client.callTool({ name: 'get_plan', arguments: { sessionId: 'done' } });
    assert.notEqual(collected.isError, true);
    assert.deepEqual(collected.structuredContent, { session: null });
    const correction = snapshot(
      await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'done-correction' } }),
    );
    const updated = snapshot(
      await client.callTool({
        name: 'save_plan',
        arguments: {
          sessionId: 'done-correction',
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
    const empty = snapshot(await first.callTool({ name: 'initialize_session', arguments: { sessionId: 'shared' } }));
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

    const reset = await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'contract' } });
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
      initialize_session: reset,
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
    const validateReset = validators.get('initialize_session')!;
    assert.equal(validateReset({ session: empty }).valid, true);
    assert.equal(validateReset({ session: empty, cleanup: { deleted: 0, skipped: [] } }).valid, false);
    const validateCollection = validators.get('collect_completed_sessions')!;
    for (const invalidCleanup of [
      undefined,
      { deleted: -1, skipped: [] },
      { deleted: 0.5, skipped: [] },
      { deleted: '0', skipped: [] },
      { deleted: 0, skipped: [{ file: 'example.json' }] },
      { deleted: 0, skipped: [{ file: 'example.json', code: 123 }] },
    ]) {
      assert.equal(validateCollection({ cleanup: invalidCleanup }).valid, false);
    }
  },
);

await test('output validation preserves cleanup details and tool execution errors', { timeout: 30_000 }, async (t) => {
  const cleanup: Array<() => Promise<void>> = [];
  const directory = await temporaryDirectory(t, cleanup);
  const client = await connect(directory);
  cleanup.push(() => client.close());
  const empty = snapshot(await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'done' } }));
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
  const fresh = await client.callTool({ name: 'initialize_session', arguments: { sessionId: 'fresh' } });
  const active = snapshot(fresh);
  const collected = await client.callTool({ name: 'collect_completed_sessions', arguments: {} });
  assert.deepEqual((collected.structuredContent as { cleanup: unknown }).cleanup, {
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
