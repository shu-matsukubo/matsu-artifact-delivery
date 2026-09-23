import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { data, Evaluator, Lexer, Parser } from '@actions/expressions';
import { parse as parseYaml } from 'yaml';
import { checkResults } from '../../scripts/check-ci.mjs';
import { formatOutputs } from '../../scripts/select-tests.mjs';
import { environmentMatrix, layers, suites, targetsFor } from '../../scripts/test-targets.mjs';
import { read, repository } from '../lib/plugin.mjs';

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

// Only provide the runner's status functions. Parsing, values and operators are
// evaluated by GitHub's library; this is not a local Actions runner or shell parser.
function evaluate(source, context = {}, status = 'success', condition = false) {
  if (source === undefined && condition) return status === 'success';
  if (typeof source !== 'string' && typeof source !== 'boolean') return source;
  const expression = String(source)
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, '$1');
  const { tokens } = new Lexer(expression).lex();
  const states = {
    always: true,
    cancelled: status === 'cancelled',
    failure: status === 'failure',
    success: status === 'success',
  };
  const functions = new Map(
    Object.entries(states).map(([name, value]) => [
      name,
      {
        name,
        minArgs: 0,
        maxArgs: 0,
        call: () => new data.BooleanData(value),
      },
    ]),
  );
  const ast = new Parser(tokens, Object.keys(context), [...functions.values()]).parse();
  const result = new Evaluator(ast, JSON.parse(JSON.stringify(context), data.reviver), functions).evaluate();
  // Actions adds success() to conditions that do not mention a status function.
  const explicitStatus = tokens.some(
    (token, index) => functions.has(token.lexeme.toLowerCase()) && tokens[index + 1]?.lexeme === '(',
  );
  if (condition && !explicitStatus && status !== 'success') return false;
  return JSON.parse(JSON.stringify(result, data.replacer));
}

await test('CI-U11: Actions selects the right layers, environments and dependencies for each change', async () => {
  const workflow = parseYaml(await read(join(repository, '.github/workflows/artifact-workflow-ci.yml')));
  for (const event of ['pull_request', 'push', 'workflow_dispatch']) assert.ok(Object.hasOwn(workflow.on, event));
  assert.equal(workflow.on.pull_request?.paths, undefined);
  assert.equal(workflow.on.pull_request?.['paths-ignore'], undefined);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const { changes, required } = workflow.jobs;
  assert.equal(changes.steps.find((step) => step.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0);
  const selector = changes.steps.find((step) => /(?:select-tests\.mjs|ci:select)/.test(step.run ?? ''));
  assert.ok(selector?.id, 'Change selection must publish job outputs');
  assert.equal(required.name, 'Quality gate'); // Branch protection depends on this public name.
  assert.deepEqual(new Set([required.needs].flat()), new Set(['changes', ...layers]));
  for (const status of ['success', 'failure', 'cancelled']) assert.equal(evaluate(required.if, {}, status, true), true);
  const gate = required.steps.find((step) => step.run?.includes('check-ci.mjs'));
  assert.ok(gate, 'The required job must run the result gate');
  assert.deepEqual(JSON.parse(evaluate(gate.env.CI_NEEDS, { needs: needs(suites) })), needs(suites));
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps)
      if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with['persist-credentials'], false);
  }

  // Path ownership is tested in CI-U01–08. Here the selected targets cross the
  // actual YAML expressions, including failures, empty layers and cancellation.
  const scenarios = [
    { selected: ['workflow', 'integration'] },
    { selected: ['escalation', 'integration'] },
    { selected: ['mcp'] },
    { selected: ['mcp', 'workflow', 'integration'] },
    { selected: ['infrastructure'] },
    { selected: ['integration'] },
    { selected: suites },
    { selected: [], result: 'failure' },
    { selected: suites, cancelled: true },
  ];
  for (const { selected, result = 'success', cancelled = false } of scenarios) {
    const published = needs(selected).changes.outputs;
    const outputs =
      result === 'success'
        ? Object.fromEntries(
            Object.entries(changes.outputs).map(([key, expression]) => [
              key,
              evaluate(expression, { steps: { [selector.id]: { outputs: published } } }),
            ]),
          )
        : {};
    const context = { needs: { changes: { result, outputs } } };
    const effective = result === 'success' ? selected : suites;
    for (const layer of layers) {
      const job = workflow.jobs[layer];
      const targets = targetsFor(layer, effective);
      const label = `${layer} / ${selected.join(',')} / ${result} / cancelled=${cancelled}`;
      assert.deepEqual(new Set([job.needs].flat()), new Set(['changes']), 'Test layers must remain independent');
      assert.equal(
        evaluate(job.if, context, cancelled ? 'cancelled' : result, true),
        !cancelled && targets.length > 0,
        label,
      );
      if (cancelled || !targets.length) continue;
      const matrix = evaluate(job.strategy.matrix, context);
      const expectedRows = environmentMatrix(effective).include;
      const identities = (rows) => new Set(rows.map(({ os, node, primary }) => `${os}/${node}/${primary}`));
      assert.equal(matrix.include.length, expectedRows.length, label);
      assert.deepEqual(identities(matrix.include), identities(expectedRows), label);
      assert.equal(job.strategy['fail-fast'], false);
      const run = job.steps.find((step) =>
        new RegExp(`\\b(?:test:${layer}|run-tests\\.mjs\\s+${layer})\\b`).test(step.run ?? ''),
      );
      assert.ok(run, `Missing ${layer} test command`);
      assert.match(
        run.run,
        /--targets-json\s+"\$(?:TEST_TARGETS|\{TEST_TARGETS\})"/,
        'Pass the selected JSON as a quoted argument',
      );
      for (const row of matrix.include) {
        const environment = { ...context, matrix: row };
        const encoded = evaluate(job.env.TEST_TARGETS, environment);
        const actual = JSON.parse(encoded);
        assert.deepEqual(actual.toSorted(), (row.primary ? targets : ['mcp']).toSorted(), label);
        assert.equal(evaluate(job['runs-on'], environment), row.os);
        const node = job.steps.find((step) => step.uses?.startsWith('actions/setup-node@'));
        assert.equal(evaluate(node.with['node-version'], environment), row.node);
        const stepContext = { ...environment, env: { TEST_TARGETS: encoded } };
        const rootInstall = job.steps.find((step) => /npm\s+ci/.test(step.run ?? ''));
        assert.ok(rootInstall, 'Skill tests need root dependencies');
        assert.equal(
          evaluate(rootInstall.if, stepContext, 'success', true),
          actual.some((target) => target !== 'mcp'),
          label,
        );
        const mcpSteps = job.steps.filter((step) => step.run?.includes('plugins/artifact-workflow'));
        assert.ok(mcpSteps.length, 'MCP tests need their dependencies');
        for (const step of mcpSteps)
          assert.equal(evaluate(step.if, stepContext, 'success', true), actual.includes('mcp'), label);
        if (layer === 'unit') {
          for (const script of ['check', 'lint', 'format:check'])
            assert.ok(
              mcpSteps.some((step) => new RegExp(`\\brun\\s+['\"]?${script}['\"]?(?:\\s|$)`).test(step.run)),
              `Missing MCP ${script}`,
            );
          const format = job.steps.find((step) => !mcpSteps.includes(step) && step.run?.includes('format:check'));
          assert.ok(format, 'Infrastructure formatting must be checked');
          assert.equal(evaluate(format.if, stepContext, 'success', true), actual.includes('infrastructure'), label);
        }
      }
    }
  }
});
