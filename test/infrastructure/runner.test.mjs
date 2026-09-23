import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createPlan, executePlan, parseArguments } from '../../scripts/run-tests.mjs';
import { environmentMatrix, suites, targetsFor, tests, validateTargets } from '../../scripts/test-targets.mjs';
import { repository } from '../lib/plugin.mjs';

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
  const files = (await readdir(join(repository, 'plugins/artifact-workflow/test')))
    .filter((name) => name.endsWith('.test.ts'))
    .sort();
  const registered = [...tests.unit.mcp, ...tests.e2e.mcp];
  assert.equal(new Set(registered).size, registered.length);
  assert.deepEqual(registered.sort(), files);
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
