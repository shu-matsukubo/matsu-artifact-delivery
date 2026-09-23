import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createPlan, executePlan, parseArguments } from '../../scripts/run-tests.mjs';
import { selectTests } from '../../scripts/select-tests.mjs';
import {
  assertMcpTestRegistry,
  environmentMatrix,
  suites,
  targetsFor,
  tests,
  validateTargets,
} from '../../scripts/test-targets.mjs';
import { files, repository, temporaryDirectory } from '../lib/plugin.mjs';

await test('RUN-U01: CLI supports default, comma-separated and JSON targets without accepting typos', () => {
  assert.deepEqual(parseArguments(['unit']), { layer: 'unit', targets: suites, dryRun: false });
  assert.deepEqual(parseArguments(['e2e', '--targets', 'integration,workflow', '--dry-run']), {
    layer: 'e2e',
    targets: ['workflow', 'integration'],
    dryRun: true,
  });
  assert.deepEqual(parseArguments(['all', '--targets-json', '["mcp"]']).targets, ['mcp']);
  for (const args of [
    [],
    ['unknown'],
    ['unit', '--targets'],
    ['unit', '--targets', ''],
    ['unit', '--targets', 'workflow,workflow'],
    ['unit', '--targets', 'workflow,,mcp'],
    ['unit', '--targets', 'workflow;echo oops'],
    ['unit', '--targets-json', '{}'],
    ['unit', '--targets-json', '[]'],
    ['unit', '--targets-json', '{'],
    ['unit', '--targets', 'workflow', '--targets-json', '["mcp"]'],
    ['unit', '--typo'],
  ])
    assert.throws(() => parseArguments(args));
  assert.throws(() => validateTargets([1]));
});

await test('RUN-U02: layer filters keep component unit tests and all selected E2E tests in separate batches', () => {
  assert.deepEqual(targetsFor('unit', suites), ['mcp', 'workflow', 'escalation', 'infrastructure']);
  assert.deepEqual(targetsFor('e2e', suites), ['mcp', 'workflow', 'escalation', 'integration']);
  const unit = createPlan('unit', ['workflow', 'escalation']);
  assert.equal(unit.commands.length, 1);
  assert.deepEqual(unit.commands[0].args, ['--test', 'test/workflow/unit.test.mjs', 'test/escalation/unit.test.mjs']);
  const e2e = createPlan('e2e', ['workflow', 'integration']);
  assert.deepEqual(e2e.commands[0].args, ['--test', 'test/workflow/e2e.test.mjs', 'test/integration/*.test.mjs']);
  assert.throws(() => createPlan('e2e', ['infrastructure']), /No e2e tests/);
  assert.throws(() => createPlan('unknown', ['mcp']), /Unknown test layer/);
  assert.throws(() => targetsFor('unknown', suites));
});

await test('RUN-U03: MCP unit and E2E registries cover every existing test exactly once', async () => {
  const discovered = (await files(join(repository, 'plugins/artifact-workflow/test')))
    .filter((name) => name.endsWith('.test.ts'))
    .sort();
  const registered = [...tests.unit.mcp, ...tests.e2e.mcp];
  assert.equal(new Set(registered).size, registered.length);
  assert.deepEqual(registered.sort(), discovered);
  assert.deepEqual(tests.e2e.mcp, ['mcp.test.ts']);
  for (const layer of ['unit', 'e2e']) {
    const plan = createPlan(layer, ['mcp']);
    assert.deepEqual(
      plan.commands.slice(0, 3).map(({ args }) => args),
      [['scripts/build.mjs', '--check'], ['scripts/clean-test.mjs'], ['node_modules/typescript/bin/tsc']],
    );
    const executed = plan.commands[3].args.slice(1);
    assert.equal(executed.includes('.test-build/test/mcp.test.js'), layer === 'e2e');
    assert.equal(executed.includes('.test-build/test/store.test.js'), layer === 'unit');
  }
  const all = createPlan('all', suites);
  assert.equal(all.commands.filter(({ label }) => label === 'MCP compile tests').length, 1);
  assert.equal(all.batches.length, 2);
});

await test('RUN-U04: extra environments execute MCP only; Skill changes keep a single environment', () => {
  const minimal = { include: [{ os: 'ubuntu-latest', node: '22.19.0', primary: true }] };
  assert.deepEqual(environmentMatrix(['workflow', 'integration']), minimal);
  const matrix = environmentMatrix(['mcp', 'workflow']);
  assert.equal(matrix.include.length, 6);
  assert.deepEqual(
    matrix.include.filter(({ primary }) => primary),
    minimal.include,
  );
  assert.deepEqual(
    [...new Set(matrix.include.map(({ os }) => os))],
    ['ubuntu-latest', 'windows-latest', 'macos-latest'],
  );
  assert.deepEqual([...new Set(matrix.include.map(({ node }) => node))], ['22.19.0', '24']);
});

await test('RUN-U05: subprocesses use Node directly and propagate failure without running later tests', () => {
  const plan = createPlan('all', ['mcp']);
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  };
  assert.equal(executePlan(plan, execute), 0);
  assert.equal(calls.length, plan.commands.length);
  assert.ok(calls.every(({ command, options }) => command === process.execPath && options.shell === false));
  let attempts = 0;
  assert.equal(
    executePlan(plan, () => {
      attempts++;
      return { status: 7 };
    }),
    7,
  );
  assert.equal(attempts, 1);
  assert.equal(
    executePlan(plan, () => ({ status: null, signal: 'SIGTERM' })),
    1,
  );
  assert.throws(() => executePlan(plan, () => ({ error: new Error('spawn failed') })), /spawn failed/);
});

await test('RUN-U06: runner CLI exposes its exact plan and refuses empty or invalid requests', () => {
  const invoke = (...args) =>
    execFileSync(process.execPath, [join(repository, 'scripts/run-tests.mjs'), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const plan = JSON.parse(invoke('unit', '--targets', 'workflow', '--dry-run'));
  assert.deepEqual(plan.batches, [{ layer: 'unit', targets: ['workflow'] }]);
  assert.equal(plan.commands.length, 1);
  assert.throws(() => invoke('unit', '--targets', 'unknown'), { status: 1 });
  assert.throws(() => invoke('unit', '--targets', 'integration'), { status: 1 });
});

await test('RUN-U07: MCP preflight rejects unregistered, duplicate and missing files, including nested tests', async (t) => {
  const directory = await temporaryDirectory(t);
  await writeFile(join(directory, 'unit.test.ts'), '');
  await writeFile(join(directory, 'e2e.test.ts'), '');
  await writeFile(join(directory, 'helper.ts'), '');
  const registry = { unit: { mcp: ['unit.test.ts'] }, e2e: { mcp: ['e2e.test.ts'] } };
  assert.doesNotThrow(() => assertMcpTestRegistry(directory, registry));
  assert.throws(
    () => assertMcpTestRegistry(directory, { ...registry, e2e: { mcp: ['e2e.test.ts', 'unit.test.ts'] } }),
    /Duplicate MCP registrations: unit\.test\.ts/,
  );
  assert.throws(
    () => assertMcpTestRegistry(directory, { ...registry, unit: { mcp: ['unit.test.ts', 'absent.test.ts'] } }),
    /Missing MCP test files: absent\.test\.ts/,
  );
  await unlink(join(directory, 'unit.test.ts'));
  assert.throws(() => assertMcpTestRegistry(directory, registry), /Missing MCP test files: unit\.test\.ts/);
  await writeFile(join(directory, 'unit.test.ts'), '');
  await mkdir(join(directory, 'nested'));
  await writeFile(join(directory, 'nested/new.test.ts'), '');
  assert.throws(() => assertMcpTestRegistry(directory, registry), /Unregistered MCP tests: nested\/new\.test\.ts/);
  assert.doesNotThrow(() =>
    assertMcpTestRegistry(directory, { ...registry, unit: { mcp: ['unit.test.ts', 'nested/new.test.ts'] } }),
  );
});

await test('RUN-U08: MCP-only CI fails before preparation when a new test is unregistered', async (t) => {
  const root = await temporaryDirectory(t);
  await mkdir(join(root, 'scripts'));
  for (const file of ['run-tests.mjs', 'test-targets.mjs'])
    await copyFile(join(repository, 'scripts', file), join(root, 'scripts', file));
  const directory = join(root, 'plugins/artifact-workflow/test');
  await mkdir(directory, { recursive: true });
  for (const file of [...tests.unit.mcp, ...tests.e2e.mcp]) {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await writeFile(join(directory, file), '');
  }
  const invoke = (...args) =>
    execFileSync(process.execPath, [join(root, 'scripts/run-tests.mjs'), ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  assert.equal(JSON.parse(invoke('unit', '--targets', 'mcp', '--dry-run')).batches[0].layer, 'unit');
  const newTest = 'plugins/artifact-workflow/test/unregistered.test.ts';
  await writeFile(join(root, newTest), 'throw new Error("This test must not be silently omitted");');
  const selected = selectTests([newTest]).selected;
  assert.deepEqual(selected, ['mcp']);
  for (const layer of ['unit', 'e2e', 'all']) {
    assert.throws(
      () => invoke(layer, '--targets-json', JSON.stringify(selected)),
      (error) => {
        assert.equal(error.status, 1);
        assert.match(error.stderr, /Unregistered MCP tests: unregistered\.test\.ts/);
        assert.doesNotMatch(error.stdout, /\[MCP/);
        return true;
      },
    );
  }
  assert.throws(() => invoke('unit', '--targets', 'mcp', '--dry-run'), { status: 1 });
  assert.deepEqual(JSON.parse(invoke('unit', '--targets', 'workflow', '--dry-run')).batches, [
    { layer: 'unit', targets: ['workflow'] },
  ]);
});
