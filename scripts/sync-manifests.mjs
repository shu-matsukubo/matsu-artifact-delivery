import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validatePortable } from './validate-manifests.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const names = ['artifact-workflow', 'expert-escalation'];
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const serialize = (value) => JSON.stringify(value, null, 2) + '\n';

export async function syncManifests(root, { adoptCachebuster = false, check = false } = {}) {
  const canonicalPath = join(root, 'plugin.json');
  const compatibilityPath = join(root, '.codex-plugin/plugin.json');
  const manifest = await readJson(canonicalPath);
  validatePortable(manifest, 'plugin');
  assert.ok(names.includes(manifest.name), 'Unknown plugin');
  const compatibility = await readJson(compatibilityPath);
  assert.equal(compatibility.name, manifest.name, 'Inconsistent plugin name');
  if (adoptCachebuster) {
    assert.ok(!check, 'Cannot adopt a cachebuster in check mode');
    const base = manifest.version.split('+')[0];
    assert.equal(compatibility.version.split('+')[0], base, 'Cachebuster must preserve the canonical base version');
    assert.match(compatibility.version.slice(base.length), /^\+codex\.[a-z0-9]+(?:-[a-z0-9]+)*$/);
    manifest.version = compatibility.version;
  }
  const { $schema, extensions, ...identity } = manifest;
  // Preserve Codex-only presentation fields, refreshing all portable metadata.
  const { id, skills, apps, mcpServers, interface: display } = compatibility;
  const generated = {
    ...identity,
    ...(id === undefined ? {} : { id }),
    skills,
    ...(apps === undefined ? {} : { apps }),
    ...(mcpServers === undefined ? {} : { mcpServers }),
    interface: { ...display, longDescription: manifest.description, developerName: manifest.author.name },
  };
  const outputs = new Map([[compatibilityPath, generated]]);
  if (adoptCachebuster) outputs.set(canonicalPath, manifest);
  if (manifest.name === 'artifact-workflow') {
    const mcp = await readJson(join(root, 'mcp.json'));
    validatePortable(mcp, 'mcp');
    outputs.set(join(root, '.mcp.json'), { mcpServers: mcp.mcpServers });
  }
  for (const [path, value] of outputs) {
    if (check) assert.deepEqual(await readJson(path), value, 'Outdated compatibility manifest: ' + path);
    else await writeFile(path, serialize(value));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const adopt = args.length === 2 && args[0] === '--adopt-cachebuster' && names.includes(args[1]);
  const check = args.length === 1 && args[0] === '--check';
  assert.ok(
    args.length === 0 || check || adopt,
    'Usage: node scripts/sync-manifests.mjs [--check | --adopt-cachebuster <plugin>]',
  );
  for (const name of adopt ? [args[1]] : names) {
    await syncManifests(join(repository, 'plugins', name), { adoptCachebuster: adopt, check });
    console.log((check ? 'Checked: ' : 'Synchronized: ') + name);
  }
}
