import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { packageMarketplace, packagePlugin } from '../../scripts/package-plugins.mjs';
import { syncManifests } from '../../scripts/sync-manifests.mjs';
import {
  files,
  json,
  loadPlugin,
  localLinks,
  pluginRoot,
  read,
  repository,
  stagePlugin,
  temporaryDirectory,
} from '../lib/plugin.mjs';

const execute = promisify(execFile);
const writeJson = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const snapshot = async (root) =>
  Promise.all((await files(root)).map(async (path) => [path, (await readFile(join(root, path))).toString('base64')]));

await test('MAN-U01: portable manifest schema rejects Codex fields, unsupported versions and invalid nested metadata', async (t) => {
  const plugin = await stagePlugin(t, 'expert-escalation');
  const path = join(plugin.root, 'plugin.json');
  for (const invalid of [
    { ...plugin.manifest, mcpServers: './mcp.json' },
    { ...plugin.manifest, skills: './skills/' },
    { ...plugin.manifest, $schema: plugin.manifest.$schema.replace('/1.0.0/', '/9.0.0/') },
    { ...plugin.manifest, $schema: undefined },
    { ...plugin.manifest, author: { name: 'Author', unsupported: true } },
    { ...plugin.manifest, keywords: [42] },
  ]) {
    await writeJson(path, invalid);
    await assert.rejects(loadPlugin(plugin.root), /schema/i);
  }
  await writeJson(path, plugin.manifest);
  await loadPlugin(plugin.root);
});

await test('MAN-U02: MCP schema rejects invalid transports, extra fields, reserved env and unsupported schema versions', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  const path = join(plugin.root, 'mcp.json');
  const original = await json(path);
  for (const invalid of [null, false, '', []]) {
    await writeJson(path, invalid);
    await assert.rejects(loadPlugin(plugin.root), /schema/i);
  }
  for (const mutate of [
    (value) => {
      value.$schema = value.$schema.replace('/1.0.0/', '/2.0.0/');
    },
    (value) => {
      value.mcpServers['artifact-task-memory'].type = 'http';
    },
    (value) => {
      value.mcpServers['artifact-task-memory'].url = 'https://example.invalid';
    },
    (value) => {
      value.mcpServers['artifact-task-memory'].env.PLUGIN_ROOT = '/other';
    },
    (value) => {
      value.mcpServers['artifact-task-memory'].command = ['node'];
    },
  ]) {
    const invalid = structuredClone(original);
    mutate(invalid);
    await writeJson(path, invalid);
    await assert.rejects(loadPlugin(plugin.root), /schema/i);
  }
  await writeJson(path, original);
  await loadPlugin(plugin.root);
});

await test('MAN-U03: compatibility divergence, escaping cwd and missing runtime files fail outside schema validation', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  const compatibilityPath = join(plugin.root, '.mcp.json');
  const original = await json(compatibilityPath);
  await writeJson(compatibilityPath, { mcpServers: {} });
  await assert.rejects(loadPlugin(plugin.root), /Inconsistent MCP/);
  await writeJson(compatibilityPath, original);
  const manifestPath = join(plugin.root, '.codex-plugin/plugin.json');
  await writeJson(manifestPath, { ...plugin.codex, unsupported: true });
  await assert.rejects(loadPlugin(plugin.root), /Unsupported Codex field/);
  await writeJson(manifestPath, plugin.codex);
  const portable = await json(join(plugin.root, 'mcp.json'));
  const escaped = structuredClone(portable);
  escaped.mcpServers['artifact-task-memory'].cwd = './../../../outside';
  await writeJson(join(plugin.root, 'mcp.json'), escaped);
  await writeJson(compatibilityPath, { mcpServers: escaped.mcpServers });
  await assert.rejects(loadPlugin(plugin.root), /Path escapes package/);
  await writeJson(join(plugin.root, 'mcp.json'), portable);
  await writeJson(compatibilityPath, original);
  await unlink(join(plugin.root, 'mcp/task-memory.cjs'));
  await assert.rejects(loadPlugin(plugin.root), { code: 'ENOENT' });
});

await test('PKG-U05: production packaging is byte-identical with development dependencies and stale output present', async (t) => {
  const temporary = await temporaryDirectory(t);
  for (const name of ['artifact-workflow', 'expert-escalation']) {
    const source = join(temporary, name);
    await packagePlugin(pluginRoot(name), source);
    const clean = join(temporary, name + '-clean');
    await packagePlugin(source, clean);
    for (const path of [
      'node_modules/a/index.js',
      '.build/stale.js',
      '.test-build/deleted.test.js',
      'test/extra.js',
      'scripts/extra.mjs',
      'mcp/src/extra.ts',
      'skills/' + name + '/node_modules/a/index.js',
    ]) {
      await mkdir(dirname(join(source, path)), { recursive: true });
      await writeFile(join(source, path), 'development-only content');
    }
    const dirty = join(temporary, name + '-dirty');
    await packagePlugin(source, dirty);
    assert.deepEqual(await snapshot(dirty), await snapshot(clean));
    for (const path of (await files(dirty)).filter((path) => path.endsWith('.md'))) await localLinks(dirty, path);
    await assert.rejects(packagePlugin(source, dirty), { code: 'EEXIST' });
  }
});

await test('PKG-U06: packaged marketplace uses the source catalog and CLI regeneration removes only its dedicated output', async (t) => {
  const temporary = await temporaryDirectory(t);
  const source = join(temporary, 'source');
  await packageMarketplace(repository, source);
  const output = join(source, 'dist');
  await mkdir(join(source, 'scripts'));
  await copyFile(join(repository, 'scripts/package-plugins.mjs'), join(source, 'scripts/package-plugins.mjs'));
  await writeFile(join(source, 'keep.txt'), 'source remains');
  const build = () => execute(process.execPath, [join(source, 'scripts/package-plugins.mjs')], { cwd: temporary });
  await build();
  const expected = await snapshot(output);
  assert.deepEqual(
    await json(join(output, '.agents/plugins/marketplace.json')),
    await json(join(repository, '.agents/plugins/marketplace.json')),
  );
  await mkdir(join(output, 'plugins/artifact-workflow/node_modules'));
  await writeFile(join(output, 'plugins/artifact-workflow/node_modules/stale.js'), 'stale');
  await build();
  assert.deepEqual(await snapshot(output), expected);
  assert.equal(await read(join(source, 'keep.txt')), 'source remains');
});

await test('PKG-U07: packaging refuses linked runtime directories and linked output roots', async (t) => {
  const temporary = await temporaryDirectory(t);
  const source = join(temporary, 'artifact-workflow');
  await packagePlugin(pluginRoot('artifact-workflow'), source);
  const outside = join(temporary, 'external');
  await mkdir(outside);
  await writeFile(join(outside, 'keep.txt'), 'preserve');
  // Junctions do not require developer mode or elevated symlink privileges on Windows.
  await symlink(outside, join(source, 'skills/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(packagePlugin(source, join(temporary, 'package')), /Symlink/);
  await mkdir(join(temporary, 'scripts'));
  await copyFile(join(repository, 'scripts/package-plugins.mjs'), join(temporary, 'scripts/package-plugins.mjs'));
  await symlink(outside, join(temporary, 'dist'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(execute(process.execPath, [join(temporary, 'scripts/package-plugins.mjs')]), /real directory/);
  assert.equal(await read(join(outside, 'keep.txt')), 'preserve');
});

await test('VER-U01: both plugins synchronize canonical metadata and adopt only matching helper cachebusters', async (t) => {
  for (const name of ['artifact-workflow', 'expert-escalation']) {
    const plugin = await stagePlugin(t, name);
    const path = join(plugin.root, 'plugin.json');
    const compatibilityPath = join(plugin.root, '.codex-plugin/plugin.json');
    const updated = { ...plugin.manifest, version: '9.0.0', description: 'Updated description' };
    await writeJson(path, updated);
    await assert.rejects(syncManifests(plugin.root, { check: true }), /Outdated/);
    await syncManifests(plugin.root);
    await syncManifests(plugin.root, { check: true });
    let loaded = await loadPlugin(plugin.root);
    assert.equal(loaded.codex.version, updated.version);
    assert.equal(loaded.codex.interface.longDescription, updated.description);
    assert.equal(loaded.codex.interface.displayName, plugin.codex.interface.displayName);
    const changed = { ...loaded.codex, version: '9.0.0+codex.20260924120000' };
    await writeJson(compatibilityPath, changed);
    await assert.rejects(loadPlugin(plugin.root), /Inconsistent manifest version/);
    await syncManifests(plugin.root, { adoptCachebuster: true });
    loaded = await loadPlugin(plugin.root);
    assert.equal(loaded.manifest.version, changed.version);
    for (const version of ['10.0.0+codex.20260924120000', '9.0.0+unrelated', '9.0.0+codex.one+codex.two']) {
      await writeJson(compatibilityPath, { ...changed, version });
      const before = await snapshot(plugin.root);
      await assert.rejects(syncManifests(plugin.root, { adoptCachebuster: true }));
      assert.deepEqual(await snapshot(plugin.root), before);
    }
  }
});
