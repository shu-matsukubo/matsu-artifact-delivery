import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repository = fileURLToPath(new URL('../', import.meta.url));
const common = ['plugin.json', '.codex-plugin/plugin.json', 'README.md', 'LICENSE', 'skills', 'com.openai/agents'];
const runtime = [
  'mcp.json',
  '.mcp.json',
  'mcp/task-memory.cjs',
  'mcp/task-memory.cjs.LEGAL.txt',
  'mcp/THIRD_PARTY_LICENSES.txt',
];
const excluded = new Set(['node_modules', '.build', '.test-build', '.git']);

// This is the production package boundary, also used by isolated package tests.
export async function packageFiles(source) {
  const manifest = JSON.parse(await readFile(join(source, 'plugin.json'), 'utf8'));
  assert.ok(['artifact-workflow', 'expert-escalation'].includes(manifest.name), 'Unknown package');
  assert.equal(manifest.name, basename(source));
  const result = [];
  async function visit(path) {
    assert.ok(!path.split('/').some((part) => excluded.has(part)), `Development directory in package: ${path}`);
    const info = await lstat(join(source, path));
    assert.ok(!info.isSymbolicLink(), `Symlink in package: ${path}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(join(source, path))).sort()) {
        if (!excluded.has(name)) await visit(`${path}/${name}`);
      }
    } else {
      assert.ok(info.isFile(), `Not a regular file: ${path}`);
      result.push(path);
    }
  }
  // Check parent directories too; a symlink at mcp/ must not bypass containment.
  for (const path of [...common, ...(manifest.name === 'artifact-workflow' ? runtime : [])]) {
    const parts = path.split('/');
    for (let count = 1; count < parts.length; count++) {
      const parent = parts.slice(0, count).join('/');
      assert.ok(!(await lstat(join(source, parent))).isSymbolicLink(), `Symlink in package: ${parent}`);
    }
    await visit(path);
  }
  return result.sort();
}

export async function packagePlugin(source, destination) {
  const paths = await packageFiles(source);
  // Refuse existing destinations so obsolete or unlisted files cannot survive.
  await mkdir(destination, { recursive: false });
  for (const path of paths) {
    await mkdir(dirname(join(destination, path)), { recursive: true });
    await copyFile(join(source, path), join(destination, path));
  }
  return paths;
}

export async function packageMarketplace(source, destination) {
  const catalogPath = '.agents/plugins/marketplace.json';
  const catalog = JSON.parse(await readFile(join(source, catalogPath), 'utf8'));
  assert.match(catalog.name, /^[A-Za-z0-9_-]+$/);
  assert.equal(new Set(catalog.plugins.map((entry) => entry.name)).size, catalog.plugins.length);
  for (const entry of catalog.plugins) {
    assert.ok(['artifact-workflow', 'expert-escalation'].includes(entry.name), 'Unknown package');
    assert.equal(entry.source.source, 'local');
    assert.equal(entry.source.path, `./plugins/${entry.name}`);
  }
  await mkdir(destination, { recursive: false });
  await mkdir(join(destination, 'plugins'));
  for (const entry of catalog.plugins) {
    await packagePlugin(join(source, entry.source.path), join(destination, entry.source.path));
  }
  await mkdir(dirname(join(destination, catalogPath)), { recursive: true });
  // Preserve the catalog; paths are relative to the generated marketplace root.
  await copyFile(join(source, catalogPath), join(destination, catalogPath));
}

export async function main(args = process.argv.slice(2)) {
  assert.equal(args.length, 0, 'Usage: node scripts/package-plugins.mjs');
  const root = await realpath(repository);
  const output = resolve(root, 'dist');
  assert.equal(relative(root, output), 'dist');
  try {
    const info = await lstat(output);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'dist must be a real directory');
    const actual = await realpath(output);
    assert.ok(actual.startsWith(`${root}${sep}`) && relative(root, actual) === 'dist', 'Unsafe package output');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await rm(output, { recursive: true, force: true, maxRetries: 5 });
  await packageMarketplace(root, output);
  console.log(`Packaged marketplace: ${output}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
