import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, cp, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { packageMarketplace } from '../../scripts/package-plugins.ts';
import { syncManifests } from '../../scripts/sync-manifests.ts';
import { registerContracts } from '../lib/contract-suite.ts';
import {
  assertContract,
  inside,
  json,
  loadPlugin,
  pluginRoot,
  read,
  repository,
  temporaryDirectory,
} from '../lib/plugin.ts';

import type {
  CodexManifest,
  McpManifest,
  PackageLock,
  PackageMetadata,
  PluginManifest,
} from '../../scripts/manifest-types.ts';
import type { FileContract } from '../lib/types.ts';

await registerContracts(
  {
    name: 'artifact-workflow',
    prefix: 'WF',
    implicit: false,
    agents: [],
    readOnly: [],
  },
  new URL('./contracts.json', import.meta.url),
);

await test('WF-U18: MCP manifests and package metadata resolve to the shipped runtime', async () => {
  const root = pluginRoot('artifact-workflow');
  const { manifest, codex } = await loadPlugin(root);
  const packageMetadata = await json<PackageMetadata>(join(root, 'package.json'));
  assert.equal(packageMetadata.name, manifest.name);
  // Only the normalized suffix accepted by --adopt-cachebuster is a local
  // cache key. Release and unrelated build metadata must still match exactly.
  const cachebuster = /^([^+]+)\+codex\.[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(manifest.version);
  const expectedVersion = cachebuster ? cachebuster[1] : manifest.version;
  assert.equal(packageMetadata.version, expectedVersion);
  const lockfile = await json<PackageLock>(join(root, 'package-lock.json'));
  assert.equal(lockfile.version, packageMetadata.version, 'Lockfile version differs from package.json');
  assert.equal(
    lockfile.packages['']!.version,
    packageMetadata.version,
    'Root lockfile package version differs from package.json',
  );
  const portable = await json<McpManifest>(join(root, 'mcp.json'));
  const compatibility = await json<McpManifest>(inside(root, codex.mcpServers!));
  assert.deepEqual(compatibility.mcpServers, portable.mcpServers);
  assert.deepEqual(Object.keys(portable.mcpServers), ['artifact-task-memory']);
  const server = portable.mcpServers['artifact-task-memory']!;
  assert.equal(server.type, 'stdio');
  assert.equal(server.command, 'powershell.exe');
  assert.deepEqual(server.args, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${PLUGIN_ROOT}/mcp/start.ps1']);
  assert.deepEqual(server.env, { ARTIFACT_WORKFLOW_DATA_DIR: '${PLUGIN_DATA}/task-memory' });
  assert.ok((await stat(inside(root, server.args.at(-1)!.replace('${PLUGIN_ROOT}/', '')))).isFile());
  const nodeRuntime = await json<{
    version: string;
    platform: string;
    archive: string;
    archiveSha256: string;
    source: string;
    sourceSha256: string;
    checksums: string;
    license: string;
    licenseSource: string;
    licenseSha256: string;
  }>(join(root, 'mcp/node-runtime.json'));
  assert.deepEqual(nodeRuntime, {
    version: '22.23.2',
    platform: 'win32-x64',
    archive: 'node-win-x64.zip',
    archiveSha256: 'dcce5e49aed07c620fef0122daeeb435a8bd5157a82f0aa0b4b621eadaac5f78',
    source: 'https://nodejs.org/dist/v22.23.2/win-x64/node.exe',
    sourceSha256: '0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4',
    checksums: 'https://nodejs.org/dist/v22.23.2/SHASUMS256.txt',
    license: 'NODE_RUNTIME_LICENSES.txt',
    licenseSource: 'https://raw.githubusercontent.com/nodejs/node/v22.23.2/LICENSE',
    licenseSha256: 'c738ae413cf561f174e34f6961f8ca458aae2369a73640dda6234c629b98bcc4',
  });
  for (const path of ['mcp/start.ps1', `mcp/${nodeRuntime.archive}`, `mcp/${nodeRuntime.license}`])
    assert.ok((await stat(join(root, path))).isFile(), `Missing bundled Windows runtime file: ${path}`);
});

await test('WF-U19: the optional consultation unit contract rejects missing installation and fallback safeguards', async () => {
  const cases = await json<FileContract[]>(new URL('./contracts.json', import.meta.url));
  const contract = cases.find((item) => item.id === 'WF-U14');
  assert.ok(contract, 'Missing WF-U14 contract');
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
  // Fifteen separate Node processes also strip the shared TypeScript harness.
  { timeout: 60_000 },
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
    const manifest = await json<PluginManifest>(join(root, 'plugin.json'));
    const metadata = await json<PackageMetadata>(join(root, 'package.json'));
    const lockfile = await json<PackageLock>(join(root, 'package-lock.json'));
    const writeJson = (path: string, value: unknown) =>
      writeFile(join(root, path), JSON.stringify(value, null, 2) + '\n');
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
          const compatibility = await json<CodexManifest>(join(root, '.codex-plugin/plugin.json'));
          await writeJson('.codex-plugin/plugin.json', { ...compatibility, version: scenario.pluginVersion });
          await syncManifests(root, { adoptCachebuster: true });
          assert.equal((await json<PluginManifest>(join(root, 'plugin.json'))).version, scenario.pluginVersion);
          assert.deepEqual(
            await Promise.all(['package.json', 'package-lock.json'].map((path) => read(join(root, path)))),
            before,
          );
        }
        let result: { code: number; stdout: string; stderr: string };
        try {
          result = {
            ...(await execute(
              process.execPath,
              ['--test', '--test-name-pattern=^WF-U18:', 'test/workflow/unit.test.ts'],
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
          if (
            !(error instanceof Error) ||
            !('code' in error) ||
            typeof error.code !== 'number' ||
            !('stdout' in error) ||
            typeof error.stdout !== 'string' ||
            !('stderr' in error) ||
            typeof error.stderr !== 'string'
          )
            throw error;
          result = { code: error.code, stdout: error.stdout, stderr: error.stderr };
        }
        assert.equal(result.code, scenario.reject ? 1 : 0, result.stdout + result.stderr);
        assert.match(result.stdout, scenario.reject ? /not ok \d+ - WF-U18:/ : /ok \d+ - WF-U18:/);
        assert.match(result.stdout, scenario.reject ? /ERR_ASSERTION/ : /# pass 1\b/);
      });
    }
  },
);
