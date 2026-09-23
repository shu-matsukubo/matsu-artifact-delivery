import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';
import { checkResults } from '../../scripts/check-ci.mjs';
import { suites } from '../../scripts/select-tests.mjs';
import { json, read, repository } from '../lib/plugin.mjs';

const needs = (mcp, selected, mcpResult = 'skipped', contractsResult = 'success') => ({
  changes: { result: 'success', outputs: { mcp: String(mcp), suites: JSON.stringify(selected) } },
  mcp: { result: mcpResult },
  contracts: { result: contractsResult },
});

await test('CI-U09: required-check gate accepts only successful selected jobs', () => {
  assert.deepEqual(checkResults(needs(false, ['workflow', 'integration'])), []);
  assert.deepEqual(checkResults(needs(true, [], 'success', 'skipped')), []);
  assert.deepEqual(checkResults(needs(true, suites.slice(1), 'success')), []);
  for (const result of ['failure', 'cancelled', 'skipped']) {
    assert.ok(checkResults(needs(true, [], result, 'skipped')).length);
    assert.ok(checkResults(needs(false, ['workflow'], 'skipped', result)).length);
  }
  const missing = needs(true, ['workflow']);
  delete missing.mcp;
  const missingContracts = needs(false, ['workflow']);
  delete missingContracts.contracts;
  assert.ok(checkResults(missingContracts).length);
  assert.ok(checkResults(missing).length);
  for (const outputs of [
    {},
    { mcp: 'true', suites: 'invalid' },
    { mcp: 'false', suites: '["unknown"]' },
    { mcp: 'false', suites: '["workflow","workflow"]' },
  ]) {
    assert.ok(checkResults({ ...needs(false, []), changes: { result: 'success', outputs } }).length);
  }
  assert.ok(checkResults({ ...needs(false, []), changes: { result: 'failure' } }).length);
  assert.ok(checkResults({}).length);
});

await test('CI-U10: gate CLI returns nonzero on failure or malformed job data', () => {
  const invoke = (value) =>
    execFileSync(process.execPath, [join(repository, 'scripts/check-ci.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, CI_NEEDS: value },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  assert.match(invoke(JSON.stringify(needs(false, ['workflow']))), /passed/);
  assert.throws(() => invoke(JSON.stringify(needs(true, ['workflow']))), { status: 1 });
  assert.throws(() => invoke('{'), { status: 1 });
});

await test('CI-U11: Actions wiring preserves full manual runs, safe checkout and selective matrices', async () => {
  const workflow = parseYaml(await read(join(repository, '.github/workflows/artifact-workflow-ci.yml')));
  for (const event of ['pull_request', 'push', 'workflow_dispatch']) assert.ok(Object.hasOwn(workflow.on, event));
  assert.equal(workflow.on.pull_request?.paths, undefined);
  assert.equal(workflow.on.pull_request?.['paths-ignore'], undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const { changes, mcp, contracts, required } = workflow.jobs;
  assert.equal(changes.steps.find((step) => step.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0);
  assert.ok(changes.steps.some((step) => step.run === 'node scripts/select-tests.mjs' && step.id === 'select'));
  assert.equal(
    mcp.if,
    "${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.mcp != 'false') }}",
  );
  assert.equal(
    contracts.if,
    "${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.suites != '[]') }}",
  );
  assert.deepEqual(mcp.strategy.matrix.os, ['ubuntu-latest', 'windows-latest', 'macos-latest']);
  assert.deepEqual(mcp.strategy.matrix.node, ['22.19.0', '24']);
  assert.match(contracts.strategy.matrix.suite, /fromJSON\(needs.changes.outputs.suites \|\|/);
  for (const suite of suites.slice(1)) assert.ok(contracts.strategy.matrix.suite.includes(`"${suite}"`));
  assert.deepEqual(mcp.needs, ['changes']);
  assert.deepEqual(contracts.needs, ['changes']);
  assert.equal(required.name, 'Quality gate');
  assert.equal(required.if, '${{ always() }}');
  assert.deepEqual(required.needs, ['changes', 'mcp', 'contracts']);
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
  assert.ok(pkg.scripts.test.includes('test:contracts') && pkg.scripts.test.includes('test:mcp'));
  for (const suite of ['workflow', 'escalation']) {
    assert.ok(pkg.scripts[`test:${suite}`].includes(`test:${suite}:unit`));
    assert.ok(pkg.scripts[`test:${suite}`].includes(`test:${suite}:e2e`));
  }
});
