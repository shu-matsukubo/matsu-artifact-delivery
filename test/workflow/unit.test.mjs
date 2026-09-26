import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, cp, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { packageMarketplace } from '../../scripts/package-plugins.mjs';
import { syncManifests } from '../../scripts/sync-manifests.mjs';
import { registerContracts } from '../lib/contract-suite.mjs';
import {
  assertContract,
  inside,
  json,
  loadPlugin,
  pluginRoot,
  read,
  repository,
  temporaryDirectory,
} from '../lib/plugin.mjs';

await registerContracts(
  {
    name: 'artifact-workflow',
    prefix: 'WF',
    implicit: false,
    agents: ['artifact-worker', 'artifact-reviewer'],
    readOnly: ['artifact-reviewer'],
  },
  new URL('./contracts.json', import.meta.url),
);

await test('WF-U18: MCP manifests and package metadata resolve to the shipped runtime', async () => {
  const root = pluginRoot('artifact-workflow');
  const { manifest, codex } = await loadPlugin(root);
  const packageMetadata = await json(join(root, 'package.json'));
  assert.equal(packageMetadata.name, manifest.name);
  // Only the normalized suffix accepted by --adopt-cachebuster is a local
  // cache key. Release and unrelated build metadata must still match exactly.
  const cachebuster = /^([^+]+)\+codex\.[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(manifest.version);
  const expectedVersion = cachebuster ? cachebuster[1] : manifest.version;
  assert.equal(packageMetadata.version, expectedVersion);
  const lockfile = await json(join(root, 'package-lock.json'));
  assert.equal(lockfile.version, packageMetadata.version, 'Lockfile version differs from package.json');
  assert.equal(
    lockfile.packages[''].version,
    packageMetadata.version,
    'Root lockfile package version differs from package.json',
  );
  const portable = await json(join(root, 'mcp.json'));
  const compatibility = await json(inside(root, codex.mcpServers));
  assert.deepEqual(compatibility.mcpServers, portable.mcpServers);
  assert.deepEqual(Object.keys(portable.mcpServers), ['artifact-task-memory']);
  const server = portable.mcpServers['artifact-task-memory'];
  assert.equal(server.type, 'stdio');
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args, ['${PLUGIN_ROOT}/mcp/task-memory.cjs']);
  assert.deepEqual(server.env, { ARTIFACT_WORKFLOW_DATA_DIR: '${PLUGIN_DATA}/task-memory' });
  assert.ok((await stat(inside(root, server.args[0].replace('${PLUGIN_ROOT}/', '')))).isFile());
});

await test('WF-U19: the optional consultation unit contract rejects missing installation and fallback safeguards', async () => {
  const cases = await json(new URL('./contracts.json', import.meta.url));
  const contract = cases.find((item) => item.id === 'WF-U14');
  const source = await read(join(pluginRoot('artifact-workflow'), contract.file));
  for (const clause of [
    '相談のためだけにインストールや環境変更を要求しない',
    '起動せず消費0回。通常フローを継続する',
    '起動失敗・結果未取得',
  ]) {
    assert.ok(source.includes(clause), clause);
    assert.throws(() => assertContract(source.replaceAll(clause, ''), contract), /WF-U14: missing/, clause);
  }
});

await test(
  'WF-U20: WF-U18 accepts adopted cachebusters and rejects release or lockfile drift',
  { timeout: 30_000 },
  async (t) => {
    // Run the real WF-U18 in a separate package copy. The name filter prevents
    // re-entering this regression and keeps production versions unchanged.
    const fixture = join(await temporaryDirectory(t), 'source');
    await packageMarketplace(repository, fixture);
    for (const path of ['scripts', 'test/lib', 'test/schemas', 'test/workflow']) {
      await cp(join(repository, path), join(fixture, path), { recursive: true });
    }
    await copyFile(join(repository, 'package.json'), join(fixture, 'package.json'));
    await symlink(
      join(repository, 'node_modules'),
      join(fixture, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const root = join(fixture, 'plugins/artifact-workflow');
    for (const path of ['package.json', 'package-lock.json']) {
      await copyFile(join(pluginRoot('artifact-workflow'), path), join(root, path));
    }
    const manifest = await json(join(root, 'plugin.json'));
    const metadata = await json(join(root, 'package.json'));
    const lockfile = await json(join(root, 'package-lock.json'));
    const writeJson = (path, value) => writeFile(join(root, path), JSON.stringify(value, null, 2) + '\n');
    const execute = promisify(execFile);
    const childEnv = { ...process.env };
    delete childEnv.NODE_TEST_CONTEXT;
    const cases = [
      { name: 'matching release', version: '1.2.3', pluginVersion: '1.2.3' },
      { name: 'standard timestamp', version: '1.2.3', pluginVersion: '1.2.3+codex.20260925010203', adopt: true },
      { name: 'helper custom token', version: '1.2.3', pluginVersion: '1.2.3+codex.local-20260925', adopt: true },
      {
        name: 'prerelease cachebuster',
        version: '1.2.3-rc.1',
        pluginVersion: '1.2.3-rc.1+codex.20260925010203',
        adopt: true,
      },
      { name: 'matching unrelated metadata', version: '1.2.3+build.7', pluginVersion: '1.2.3+build.7' },
      { name: 'different release', version: '1.2.3', pluginVersion: '1.2.4', reject: true },
      { name: 'different cachebuster base', version: '1.2.3', pluginVersion: '1.2.4+codex.local', reject: true },
      { name: 'different prerelease', version: '1.2.3-rc.1', pluginVersion: '1.2.3-rc.2+codex.local', reject: true },
      { name: 'unrelated suffix', version: '1.2.3', pluginVersion: '1.2.3+build.7', reject: true },
      { name: 'mixed suffixes', version: '1.2.3', pluginVersion: '1.2.3+build.7+codex.local', reject: true },
      { name: 'empty token', version: '1.2.3', pluginVersion: '1.2.3+codex.', reject: true },
      {
        name: 'unsupported token characters',
        version: '1.2.3',
        pluginVersion: '1.2.3+codex.local.extra',
        reject: true,
      },
      { name: 'unnormalized helper token', version: '1.2.3', pluginVersion: '1.2.3+codex.local--token', reject: true },
      {
        name: 'top-level lockfile drift',
        version: '1.2.3',
        pluginVersion: '1.2.3+codex.local',
        lockVersion: '1.2.4',
        reject: true,
      },
      {
        name: 'root package lockfile drift',
        version: '1.2.3',
        pluginVersion: '1.2.3+codex.local',
        lockRootVersion: '1.2.4',
        reject: true,
      },
    ];
    for (const scenario of cases) {
      await t.test(scenario.name, async () => {
        await writeJson('plugin.json', {
          ...manifest,
          version: scenario.adopt ? scenario.version : scenario.pluginVersion,
        });
        await writeJson('package.json', { ...metadata, version: scenario.version });
        await writeJson('package-lock.json', {
          ...lockfile,
          version: scenario.lockVersion ?? scenario.version,
          packages: {
            ...lockfile.packages,
            '': { ...lockfile.packages[''], version: scenario.lockRootVersion ?? scenario.version },
          },
        });
        await syncManifests(root);
        if (scenario.adopt) {
          const before = await Promise.all(['package.json', 'package-lock.json'].map((path) => read(join(root, path))));
          // Fixture of the standard helper's output; CI needs neither Python nor
          // an installed plugin-creator skill to cover adoption -> actual WF-U18.
          const compatibility = await json(join(root, '.codex-plugin/plugin.json'));
          await writeJson('.codex-plugin/plugin.json', { ...compatibility, version: scenario.pluginVersion });
          await syncManifests(root, { adoptCachebuster: true });
          assert.equal((await json(join(root, 'plugin.json'))).version, scenario.pluginVersion);
          assert.deepEqual(
            await Promise.all(['package.json', 'package-lock.json'].map((path) => read(join(root, path)))),
            before,
          );
        }
        let result;
        try {
          result = {
            ...(await execute(
              process.execPath,
              ['--test', '--test-name-pattern=^WF-U18:', 'test/workflow/unit.test.mjs'],
              {
                cwd: fixture,
                env: childEnv,
                encoding: 'utf8',
                timeout: 10_000,
                windowsHide: true,
              },
            )),
            code: 0,
          };
        } catch (error) {
          if (typeof error.code !== 'number') throw error;
          result = error;
        }
        assert.equal(result.code, scenario.reject ? 1 : 0, result.stdout + result.stderr);
        assert.match(result.stdout, scenario.reject ? /not ok \d+ - WF-U18:/ : /ok \d+ - WF-U18:/);
        assert.match(result.stdout, scenario.reject ? /ERR_ASSERTION/ : /# pass 1\b/);
      });
    }
  },
);
