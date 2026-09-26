import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { checkTypeScript } from '../../scripts/check-typescript.ts';
import { repository, temporaryDirectory } from '../lib/plugin.ts';

async function fixture(t: TestContext) {
  const root = await temporaryDirectory(t);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  const put = async (path: string, contents = '') => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  };
  git('init');
  await put('.gitignore', 'node_modules/\n.build/\n.test-build/\ndist/\n');
  return { root, git, put };
}

await test('TS-U01: new and tracked JavaScript are rejected across the repository', async (t) => {
  const { root, git, put } = await fixture(t);
  const forbidden = [
    'scripts/task.js',
    'test/task.mjs',
    'plugins/new/helper.cjs',
    'ui/view.jsx',
    'notes/日本語 file.JS',
  ];
  for (const path of forbidden) await put(path);
  await put('scripts/task.ts', 'export const value: number = 1;');
  git('add', 'scripts/task.js');
  assert.deepEqual(checkTypeScript(root), forbidden.toSorted());
  // An unstaged migration must not require staging to make the local check pass.
  for (const path of forbidden) await unlink(join(root, path));
  assert.deepEqual(checkTypeScript(root), []);
});

await test('TS-U02: only the declared bundle and ignored untracked output are exempt', async (t) => {
  const { root, git, put } = await fixture(t);
  for (const path of [
    'plugins/artifact-workflow/mcp/task-memory.cjs',
    'node_modules/dependency/index.js',
    '.build/generated.mjs',
    'plugins/artifact-workflow/.test-build/test/generated.js',
    'dist/plugins/artifact-workflow/mcp/task-memory.cjs',
  ])
    await put(path);
  git('add', 'plugins/artifact-workflow/mcp/task-memory.cjs');
  assert.deepEqual(checkTypeScript(root), []);
  await put('plugins/artifact-workflow/mcp/manual.cjs');
  await put('plugins/other/mcp/task-memory.cjs');
  git('add', '-f', '.build/generated.mjs');
  assert.deepEqual(checkTypeScript(root), [
    '.build/generated.mjs',
    'plugins/artifact-workflow/mcp/manual.cjs',
    'plugins/other/mcp/task-memory.cjs',
  ]);
});

await test('TS-U03: the dependency-free CLI checks its repository and fails with actionable paths', async (t) => {
  const { root, put } = await fixture(t);
  await put('scripts/.keep');
  const script = join(root, 'scripts/check-typescript.ts');
  await copyFile(join(repository, 'scripts/check-typescript.ts'), script);
  const invoke = () =>
    execFileSync(process.execPath, [script], { cwd: dirname(root), encoding: 'utf8', stdio: 'pipe' });
  assert.match(invoke(), /All maintained code uses TypeScript/);
  await put('new-script.mjs');
  assert.throws(invoke, (error: unknown) => {
    assert.ok(error instanceof Error && 'status' in error && 'stderr' in error && typeof error.stderr === 'string');
    assert.equal(error.status, 1);
    assert.match(error.stderr, /must use TypeScript \(\.ts\)/);
    assert.match(error.stderr, /new-script\.mjs/);
    return true;
  });
});
