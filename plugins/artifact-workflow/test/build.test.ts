import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { temporaryDirectory } from './fixtures.js';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

await test(
  'distribution checks detect stale and missing files without overwriting them',
  { timeout: 60_000 },
  async (t) => {
    const directory = await temporaryDirectory(t);
    for (const path of [
      'scripts',
      'mcp',
      '.codex-plugin',
      'package.json',
      'tsconfig.json',
      'plugin.json',
      'mcp.json',
      '.mcp.json',
    ]) {
      await cp(join(root, path), join(directory, path), { recursive: true });
    }
    // Copy dependencies so esbuild sees the same module paths on every OS.
    await cp(join(root, 'node_modules'), join(directory, 'node_modules'), { recursive: true });
    const build = (check = true) =>
      execute(process.execPath, [join(directory, 'scripts/build.mjs'), ...(check ? ['--check'] : [])], {
        cwd: directory,
      });
    const outdated = (error: unknown) => error instanceof Error && error.message.includes('missing or outdated');
    const artifacts = [
      'mcp/task-memory.cjs',
      'mcp/task-memory.cjs.LEGAL.txt',
      'mcp/THIRD_PARTY_LICENSES.txt',
      '.codex-plugin/plugin.json',
      '.mcp.json',
    ];
    await build();
    const originals = new Map<string, Buffer>();
    for (const path of artifacts) {
      const filename = join(directory, path);
      const original = await readFile(filename);
      originals.set(path, original);
      const stale = Buffer.concat([original, Buffer.from('\nSTALE\n')]);
      await writeFile(filename, stale);
      await assert.rejects(build(), outdated);
      assert.deepEqual(await readFile(filename), stale);
      await unlink(filename);
      await assert.rejects(build(), outdated);
      await assert.rejects(readFile(filename), { code: 'ENOENT' });
      await writeFile(filename, original);
    }
    // npm run build must reject type errors before it can replace shipped files.
    const invalid = join(directory, 'mcp/src/type-error.ts');
    await writeFile(invalid, 'export const invalid: number = "not a number";\n');
    const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run build'] : ['run', 'build'];
    await assert.rejects(
      execute(command, args, { cwd: directory }),
      (error: unknown) =>
        error instanceof Error &&
        'stdout' in error &&
        typeof error.stdout === 'string' &&
        error.stdout.includes('TS2322'),
    );
    await unlink(invalid);
    for (const [path, original] of originals) assert.deepEqual(await readFile(join(directory, path)), original);
    const entry = join(directory, 'mcp/src/index.ts');
    await writeFile(entry, `${await readFile(entry, 'utf8')}\nconsole.error('source changed');\n`);
    await assert.rejects(build(), outdated);
    for (const [path, original] of originals) assert.deepEqual(await readFile(join(directory, path)), original);
    await build(false);
    await build();
    assert.notDeepEqual(await readFile(join(directory, artifacts[0]!)), originals.get(artifacts[0]!));
  },
);

await test('test cleanup removes deleted or renamed compiled tests before the next compilation', async (t) => {
  const directory = await temporaryDirectory(t);
  await cp(join(root, 'scripts'), join(directory, 'scripts'), { recursive: true });
  const output = join(directory, '.test-build/test');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'deleted.test.js'), 'throw new Error("stale test");');
  const source = join(directory, 'keep.ts');
  await writeFile(source, '// source must survive cleanup');
  await execute(process.execPath, [join(directory, 'scripts/clean-test.mjs')], { cwd: directory });
  await assert.rejects(readFile(join(output, 'deleted.test.js')), { code: 'ENOENT' });
  assert.equal(await readFile(source, 'utf8'), '// source must survive cleanup');
});
