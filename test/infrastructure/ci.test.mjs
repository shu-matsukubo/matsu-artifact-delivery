import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import { checkResults } from '../../scripts/check-ci.mjs';
import { formatOutputs } from '../../scripts/select-tests.mjs';
import { environmentMatrix, layers, suites, targetsFor } from '../../scripts/test-targets.mjs';
import { json, read, repository } from '../lib/plugin.mjs';

const needs = (selected, unitResult = 'success', e2eResult = 'success') => ({
  changes: {
    result: 'success',
    outputs: Object.fromEntries(
      formatOutputs({ selected })
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    ),
  },
  unit: { result: unitResult },
  e2e: { result: e2eResult },
});

await test('CI-U09: required-check gate accepts only successful selected layers', () => {
  assert.deepEqual(checkResults(needs(['workflow', 'integration'])), []);
  assert.deepEqual(checkResults(needs(['mcp'])), []);
  assert.deepEqual(checkResults(needs(['infrastructure'], 'success', 'skipped')), []);
  assert.deepEqual(checkResults(needs(['integration'], 'skipped', 'success')), []);
  assert.deepEqual(checkResults(needs(suites)), []);
  for (const layer of layers) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const required = needs(['workflow']);
      required[layer].result = result;
      assert.ok(checkResults(required).length);
    }
    const missing = needs(['workflow']);
    delete missing[layer];
    assert.ok(checkResults(missing).length);
    for (const value of [undefined, 'invalid', '{}', 'null', '["unknown"]', '["workflow","workflow"]']) {
      const invalid = needs(['workflow']);
      invalid.changes.outputs[`${layer}_targets`] = value;
      assert.ok(checkResults(invalid).length);
    }
    const wrongLayer = needs(['workflow']);
    wrongLayer.changes.outputs[`${layer}_targets`] = JSON.stringify([
      layer === 'unit' ? 'integration' : 'infrastructure',
    ]);
    assert.ok(checkResults(wrongLayer).length);
  }
  assert.ok(checkResults(needs(['infrastructure'], 'success', 'failure')).length);
  assert.ok(checkResults({ ...needs(suites), changes: { ...needs(suites).changes, result: 'failure' } }).length);
  assert.ok(checkResults({}).length);
  assert.ok(checkResults(null).length);
});

await test('CI-U10: gate CLI returns nonzero on failure or malformed job data', () => {
  const invoke = (value) =>
    execFileSync(process.execPath, [join(repository, 'scripts/check-ci.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, CI_NEEDS: value },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  assert.match(invoke(JSON.stringify(needs(['workflow', 'integration']))), /passed/);
  assert.throws(() => invoke(JSON.stringify(needs(['mcp'], 'success', 'skipped'))), { status: 1 });
  assert.throws(() => invoke('{'), { status: 1 });
  assert.throws(() => invoke('null'), { status: 1 });
});

await test('CI-U11: Actions passes selected targets to two layers and preserves the MCP environment matrix', async () => {
  const workflow = parseYaml(await read(join(repository, '.github/workflows/artifact-workflow-ci.yml')));
  for (const event of ['pull_request', 'push', 'workflow_dispatch']) assert.ok(Object.hasOwn(workflow.on, event));
  assert.equal(workflow.on.pull_request?.paths, undefined);
  assert.equal(workflow.on.pull_request?.['paths-ignore'], undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ['changes', 'e2e', 'required', 'unit']);
  const { changes, required } = workflow.jobs;
  assert.equal(changes.steps.find((step) => step.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0);
  assert.ok(changes.steps.some((step) => step.run === 'node scripts/select-tests.mjs' && step.id === 'select'));
  for (const output of ['unit_targets', 'e2e_targets', 'matrix'])
    assert.equal(changes.outputs[output], '${{ steps.select.outputs.' + output + ' }}');
  for (const layer of layers) {
    const job = workflow.jobs[layer];
    assert.deepEqual(job.needs, ['changes']);
    assert.equal(
      job.if,
      "${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs." +
        layer +
        "_targets != '[]') }}",
    );
    const matrix = job.strategy.matrix;
    assert.match(matrix, /^\$\{\{ fromJSON\(needs.changes.result == 'success' && needs.changes.outputs.matrix \|\| /);
    const fallback = JSON.parse(matrix.match(/ \|\| '([^']+)'\) }}$/)[1]);
    assert.deepEqual(fallback, environmentMatrix(suites));
    assert.equal(job['runs-on'], '${{ matrix.os }}');
    assert.equal(job.strategy['fail-fast'], false);
    assert.equal(job.defaults.run.shell, 'bash');
    assert.equal(
      job.env.TEST_TARGETS,
      "${{ matrix.primary && (needs.changes.result == 'success' && needs.changes.outputs." +
        layer +
        "_targets || '" +
        JSON.stringify(targetsFor(layer, suites)) +
        "') || '[\"mcp\"]' }}",
    );
    assert.ok(job.steps.some((step) => step.run === `npm run test:${layer} -- --targets-json "$TEST_TARGETS"`));
    assert.ok(
      job.steps.some((step) => step.run === 'npm ci --ignore-scripts' && step.if === `env.TEST_TARGETS != '["mcp"]'`),
    );
    assert.ok(
      job.steps.some(
        (step) =>
          step.run === 'npm --prefix plugins/artifact-workflow ci' &&
          step.if === "contains(fromJSON(env.TEST_TARGETS), 'mcp')",
      ),
    );
    assert.ok(
      job.steps.some(
        (step) => step.uses?.startsWith('actions/setup-node@') && step.with['node-version'] === '${{ matrix.node }}',
      ),
    );
  }
  for (const command of ['check', 'lint', 'format:check'])
    assert.ok(
      workflow.jobs.unit.steps.some(
        (step) =>
          step.run === `npm --prefix plugins/artifact-workflow run ${command}` &&
          step.if === "contains(fromJSON(env.TEST_TARGETS), 'mcp')",
      ),
    );
  assert.ok(
    workflow.jobs.unit.steps.some(
      (step) =>
        step.run === 'npm run format:check' && step.if === "contains(fromJSON(env.TEST_TARGETS), 'infrastructure')",
    ),
  );
  assert.equal(required.name, 'Quality gate');
  assert.equal(required.if, '${{ always() }}');
  assert.deepEqual(required.needs, ['changes', 'unit', 'e2e']);
  assert.ok(
    required.steps.some(
      (step) => step.run === 'node scripts/check-ci.mjs' && step.env.CI_NEEDS === '${{ toJSON(needs) }}',
    ),
  );
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps)
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
  }
  const pkg = await json(join(repository, 'package.json'));
  for (const suite of suites) assert.ok(pkg.scripts[`test:${suite}`]);
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.mjs all');
  for (const layer of layers) assert.equal(pkg.scripts[`test:${layer}`], `node scripts/run-tests.mjs ${layer}`);
  for (const target of ['workflow', 'escalation', 'mcp']) {
    assert.equal(pkg.scripts[`test:${target}`], `node scripts/run-tests.mjs all --targets ${target}`);
    for (const layer of layers)
      assert.equal(pkg.scripts[`test:${target}:${layer}`], `node scripts/run-tests.mjs ${layer} --targets ${target}`);
  }
});
