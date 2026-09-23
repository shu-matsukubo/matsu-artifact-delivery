import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { allTests, formatOutputs, selectEvent, selectTests, suites } from '../../scripts/select-tests.mjs';
import { read, repository, temporaryDirectory } from '../lib/plugin.mjs';

const workflow = ['workflow', 'integration'];
const escalation = ['escalation', 'integration'];
const packageChecks = ['mcp', ...workflow];
const cases = [
  ['plugins/artifact-workflow/skills/artifact-workflow/SKILL.md', workflow],
  ['plugins/artifact-workflow/skills/artifact-workflow/references/self-review.md', workflow],
  ['plugins/artifact-workflow/skills/artifact-workflow/agents/openai.yaml', workflow],
  ['plugins/artifact-workflow/com.openai/agents/artifact-reviewer.toml', workflow],
  ['test/workflow/contracts.json', workflow],
  ['test/workflow/e2e.test.mjs', workflow],
  ['plugins/artifact-workflow/mcp/src/server.ts', ['mcp']],
  ['plugins/artifact-workflow/mcp/task-memory.cjs', ['mcp']],
  ['plugins/artifact-workflow/mcp/THIRD_PARTY_LICENSES.txt', ['mcp']],
  ['plugins/artifact-workflow/test/mcp.test.ts', ['mcp']],
  ['plugins/artifact-workflow/tsconfig.json', ['mcp']],
  ['plugins/artifact-workflow/.oxlintrc.json', ['mcp']],
  ['plugins/artifact-workflow/.prettierrc.json', ['mcp']],
  ['plugins/artifact-workflow/scripts/build.mjs', packageChecks],
  ['plugins/artifact-workflow/plugin.json', packageChecks],
  ['plugins/artifact-workflow/.codex-plugin/plugin.json', packageChecks],
  ['plugins/artifact-workflow/mcp.json', packageChecks],
  ['plugins/artifact-workflow/.mcp.json', packageChecks],
  ['plugins/artifact-workflow/package.json', packageChecks],
  ['plugins/artifact-workflow/package-lock.json', packageChecks],
  ['plugins/artifact-workflow/README.md', workflow],
  ['plugins/artifact-workflow/LICENSE', workflow],
  ['plugins/expert-escalation/skills/expert-escalation/SKILL.md', escalation],
  ['plugins/expert-escalation/com.openai/agents/escalation-advisor.toml', escalation],
  ['plugins/expert-escalation/plugin.json', escalation],
  ['plugins/expert-escalation/.codex-plugin/plugin.json', escalation],
  ['plugins/expert-escalation/README.md', escalation],
  ['plugins/expert-escalation/LICENSE', escalation],
  ['test/escalation/unit.test.mjs', escalation],
  ['test/integration/consultation.test.mjs', ['integration']],
  ['README.md', ['infrastructure']],
  ['docs/testing.md', ['infrastructure']],
];

await test('CI-U01: each owned path selects exactly its dependent suites', async (t) => {
  for (const [path, expected] of cases)
    await t.test(path, () => assert.deepEqual(selectTests([path]).selected, expected));
});

await test('CI-U02: shared, unknown, malformed and empty changes fail open to all tests', async (t) => {
  for (const path of [
    '.github/workflows/artifact-workflow-ci.yml',
    '.agents/plugins/marketplace.json',
    '.codex/config.toml',
    'scripts/select-tests.mjs',
    'test/infrastructure/selection.test.mjs',
    'test/lib/plugin.mjs',
    'package.json',
    'package-lock.json',
    '.gitignore',
    '.gitattributes',
    '.prettierrc.json',
    'LICENSE',
    'plugins/new-plugin/SKILL.md',
    'plugins/artifact-workflow/new-runtime.js',
    'plugins/expert-escalation/mcp/server.js',
    '../README.md',
    '/README.md',
    'a//b',
    'a/./b',
    'a\\b',
    '',
    null,
  ])
    await t.test(String(path), () => assert.deepEqual(selectTests([path]).selected, suites));
  assert.deepEqual(selectTests([]).selected, suites);
  assert.deepEqual(selectTests(null).selected, suites);
});

await test('CI-U03: combined changes union dependencies; outputs contain only known names', () => {
  assert.deepEqual(selectTests([cases[0][0], cases[6][0]]).selected, packageChecks);
  assert.deepEqual(selectTests([cases[0][0], cases[22][0]]).selected, ['workflow', 'escalation', 'integration']);
  assert.deepEqual(selectTests([cases[0][0], cases[0][0]]).selected, workflow);
  assert.equal(
    formatOutputs(selectTests([cases[0][0]])),
    'unit_targets=["workflow"]\ne2e_targets=["workflow","integration"]\nmatrix={"include":[{"os":"ubuntu-latest","node":"22.19.0","primary":true}]}\n',
  );
  const outputs = (selected) =>
    Object.fromEntries(
      formatOutputs({ selected })
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
  assert.deepEqual(JSON.parse(outputs(['infrastructure']).unit_targets), ['infrastructure']);
  assert.deepEqual(JSON.parse(outputs(['infrastructure']).e2e_targets), []);
  assert.deepEqual(JSON.parse(outputs(['integration']).unit_targets), []);
  assert.deepEqual(JSON.parse(outputs(['integration']).e2e_targets), ['integration']);
  assert.deepEqual(JSON.parse(outputs(suites).unit_targets), ['mcp', 'workflow', 'escalation', 'infrastructure']);
  assert.deepEqual(JSON.parse(outputs(suites).e2e_targets), ['mcp', 'workflow', 'escalation', 'integration']);
  assert.equal(JSON.parse(outputs(['mcp']).matrix).include.length, 6);
  assert.deepEqual(allTests('manual'), { selected: suites, reason: 'manual' });
});

await test('CI-U04: unsupported events, missing/zero/unsafe refs and unavailable Git history run all', () => {
  const sha = 'a'.repeat(40);
  for (const [name, event] of [
    ['workflow_dispatch', {}],
    ['merge_group', {}],
    ['pull_request', {}],
    ['push', {}],
    ['push', { before: '0'.repeat(40), after: sha }],
    ['push', { before: '--output=oops', after: sha }],
    ['push', { before: sha, after: 'b'.repeat(40) }],
  ])
    assert.deepEqual(selectEvent(name, event).selected, suites);
});

async function gitFixture(t) {
  const cwd = await temporaryDirectory(t);
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = async (path, value) => {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), value);
  };
  git('init', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  await put(cases[0][0], 'base');
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  const base = commit();
  return { cwd, git, put, commit, base };
}

await test('CI-U05: PR uses merge-base and excludes changes made only on the base branch', async (t) => {
  const fixture = await gitFixture(t);
  fixture.git('checkout', '-b', 'topic');
  await fixture.put(cases[0][0], 'workflow change');
  const head = fixture.commit();
  fixture.git('checkout', 'main');
  await fixture.put(cases[6][0], 'base-only MCP change');
  const base = fixture.commit();
  const event = { pull_request: { base: { sha: base }, head: { sha: head } } };
  assert.deepEqual(selectEvent('pull_request', event, fixture.cwd).selected, workflow);
});

await test('CI-U06: push includes deleted paths and both sides of cross-component renames', async (t) => {
  const fixture = await gitFixture(t);
  await mkdir(dirname(join(fixture.cwd, cases[22][0])), { recursive: true });
  await rename(join(fixture.cwd, cases[0][0]), join(fixture.cwd, cases[22][0]));
  const renamed = fixture.commit();
  assert.deepEqual(selectEvent('push', { before: fixture.base, after: renamed }, fixture.cwd).selected, [
    'workflow',
    'escalation',
    'integration',
  ]);
  await unlink(join(fixture.cwd, cases[22][0]));
  const deleted = fixture.commit();
  assert.deepEqual(selectEvent('push', { before: renamed, after: deleted }, fixture.cwd).selected, escalation);
  assert.deepEqual(selectEvent('push', { before: deleted, after: deleted }, fixture.cwd).selected, suites);
});

await test('CI-U07: complete Git diff handles more than 300 files, Unicode, spaces and newlines', async (t) => {
  const fixture = await gitFixture(t);
  for (let index = 0; index < 305; index++)
    await fixture.put(`plugins/artifact-workflow/skills/artifact-workflow/references/${index}.md`, 'reference');
  await fixture.put('plugins/expert-escalation/skills/expert-escalation/参照 空白.md', 'escalation');
  if (process.platform !== 'win32')
    await fixture.put('plugins/expert-escalation/skills/expert-escalation/new\nline.md', 'escalation');
  const after = fixture.commit();
  assert.deepEqual(selectEvent('push', { before: fixture.base, after }, fixture.cwd).selected, [
    'workflow',
    'escalation',
    'integration',
  ]);
});

await test('CI-U08: selector CLI writes Actions outputs and falls back on unreadable event data', async (t) => {
  const cwd = await temporaryDirectory(t);
  const output = join(cwd, 'output');
  const invoke = (args, eventPath = join(cwd, 'missing')) =>
    JSON.parse(
      execFileSync(process.execPath, [join(repository, 'scripts/select-tests.mjs'), ...args], {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: output,
          GITHUB_EVENT_NAME: 'pull_request',
          GITHUB_EVENT_PATH: eventPath,
        },
      }),
    );
  assert.deepEqual(invoke(['--files', cases[0][0]]).selected, workflow);
  assert.equal(await read(output), formatOutputs(selectTests([cases[0][0]])));
  assert.deepEqual(invoke([]).selected, suites);
  assert.deepEqual(invoke(['--all']).selected, suites);
  assert.deepEqual(invoke(['--typo']).selected, suites);
  const invalid = join(cwd, 'invalid.json');
  await writeFile(invalid, '{');
  assert.deepEqual(invoke([], invalid).selected, suites);
});
