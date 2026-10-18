// 任意のリリース前確認。Codex CLI とリポジトリの開発依存が必要。
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { compareInstallDirectories } from './compare-install.ts';
import { packageMarketplace, repository } from './package-plugins.ts';
import { validateManifests } from './validate-manifests.ts';
import { files, json, localLinks } from '../test/lib/plugin.ts';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import type { Marketplace, McpManifest, PluginManifest } from './manifest-types.ts';

const execute = promisify(execFile);
const args = process.argv.slice(2);
let source = join(repository, 'dist');
let githubRef: string | undefined;
let sourceProvided = false;
while (args.length) {
  const arg = args.shift()!;
  if (arg === '--github-ref') {
    assert.equal(githubRef, undefined, '--github-ref can be specified once');
    githubRef = args.shift();
    assert.ok(githubRef && /^[0-9a-f]{40}$/i.test(githubRef), '--github-ref requires a full commit SHA');
  } else {
    assert.ok(
      !arg.startsWith('-') && !sourceProvided,
      'Usage: node scripts/test-install.ts [marketplace-root] [--github-ref SHA]',
    );
    source = arg;
    sourceProvided = true;
  }
}
source = resolve(source);
const temporary = await mkdtemp(join(tmpdir(), 'matsu-plugin-install-'));
const summary: Array<{ route: string; candidate: string; packages: unknown[] }> = [];
const runtimeDirectories: string[] = [];
const cli = (home: string, args: string[]) =>
  execute(process.env.CODEX_CLI ?? 'codex', args, {
    cwd: temporary,
    env: { ...process.env, CODEX_HOME: home },
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });

try {
  const routes: Array<{ route: string; candidate: string; expected: string; home: string; addSource: string[] }> = [
    {
      route: 'dist',
      candidate: 'local',
      expected: source,
      home: join(temporary, 'codex-home-dist'),
      addSource: [source],
    },
  ];
  if (githubRef) {
    const snapshot = join(temporary, 'github-snapshot');
    await mkdir(snapshot);
    await execute('git', ['init', '--quiet'], { cwd: snapshot, encoding: 'utf8', windowsHide: true });
    await execute(
      'git',
      ['fetch', '--quiet', '--depth=1', 'https://github.com/shu-matsukubo/matsu-artifact-delivery.git', githubRef],
      {
        cwd: snapshot,
        encoding: 'utf8',
        timeout: 120_000,
        windowsHide: true,
      },
    );
    const { stdout: snapshotCommit } = await execute('git', ['rev-parse', 'FETCH_HEAD'], {
      cwd: snapshot,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(
      snapshotCommit.trim().toLowerCase(),
      githubRef.toLowerCase(),
      'GitHub snapshot does not match the candidate SHA',
    );
    await execute('git', ['checkout', '--quiet', '--detach', githubRef], {
      cwd: snapshot,
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
    const snapshotDist = join(temporary, 'github-dist');
    await packageMarketplace(snapshot, snapshotDist);
    await compareInstallDirectories(source, snapshotDist, 'dist differs from the fixed GitHub candidate');
    routes[0]!.candidate = githubRef;
    routes.push({
      route: 'github',
      candidate: githubRef,
      expected: snapshot,
      home: join(temporary, 'codex-home-github'),
      addSource: ['shu-matsukubo/matsu-artifact-delivery', '--ref', githubRef],
    });
  }
  for (const route of routes) {
    await mkdir(route.home);
    await cli(route.home, ['plugin', 'marketplace', 'add', ...route.addSource, '--json']);
    const routeCatalog = await json<Marketplace>(join(route.expected, '.agents/plugins/marketplace.json'));
    const packageSummary = [];
    for (const entry of routeCatalog.plugins) {
      assert.match(entry.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.equal(entry.source.path, './plugins/' + entry.name);
      await cli(route.home, ['plugin', 'add', entry.name + '@' + routeCatalog.name, '--json']);
      const versionsRoot = join(route.home, 'plugins/cache', routeCatalog.name, entry.name);
      const versions = await readdir(versionsRoot);
      assert.equal(versions.length, 1, 'Expected one version in empty isolated home');
      const installed = join(versionsRoot, versions[0]!);
      const expected = join(route.expected, entry.source.path);
      await validateManifests(installed);
      const paths = await files(installed);
      const comparison = await compareInstallDirectories(
        installed,
        expected,
        'Installed package differs from expected',
      );
      for (const path of paths) {
        assert.ok(
          !path.split('/').some((part) => ['node_modules', '.build', '.test-build'].includes(part)),
          'Unexpected development directory: ' + path,
        );
        if (path.endsWith('.md')) await localLinks(installed, path);
      }
      const manifest = await json<PluginManifest>(join(installed, 'plugin.json'));
      const result: { name: string; version: string; files: number; bytes: number; mcp?: string } = {
        name: entry.name,
        version: manifest.version,
        files: paths.length,
        bytes: comparison.bytes,
      };
      if (entry.name === 'artifact-workflow') {
        if (process.platform === 'win32')
          for (const configName of ['mcp.json', '.mcp.json']) {
            const config = (await json<McpManifest>(join(installed, configName))).mcpServers['artifact-task-memory']!;
            const data = join(temporary, route.route, '日本語 data', configName);
            runtimeDirectories.push(join(data, 'runtime'));
            const expand = (value: string) =>
              value.replace(/\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g, (_, key) => (key === 'PLUGIN_ROOT' ? installed : data));
            const client = new Client({ name: 'distribution-check', version: '1.0.0' });
            const environment: NodeJS.ProcessEnv = {
              ...getDefaultEnvironment(),
              PLUGIN_ROOT: installed,
              PLUGIN_DATA: data,
              ...Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, expand(value)])),
            };
            environment.LOCALAPPDATA = undefined;
            environment.ARTIFACT_WORKFLOW_RUNTIME_DIR = undefined;
            const sdkEnvironment = { ...getDefaultEnvironment(), ...environment };
            assert.equal(sdkEnvironment.LOCALAPPDATA, undefined);
            assert.equal(sdkEnvironment.ARTIFACT_WORKFLOW_RUNTIME_DIR, undefined);
            try {
              await client.connect(
                new StdioClientTransport({
                  command: config.command,
                  args: config.args.map(expand),
                  cwd: temporary,
                  env: environment as Record<string, string>,
                  stderr: 'pipe',
                }),
              );
              assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), [
                'collect_completed_sessions',
                'complete_session',
                'get_plan',
                'initialize_session',
                'reset_session',
                'save_plan',
              ]);
              const response = await client.callTool({
                name: 'initialize_session',
                arguments: {
                  sessionId:
                    'distribution-check-' + route.route + '-' + (configName === 'mcp.json' ? 'portable' : 'compat'),
                },
              });
              assert.notEqual(response.isError, true, JSON.stringify(response));
              assert.equal((response.structuredContent as { session: { plan: unknown } }).session.plan, null);
            } finally {
              await client.close();
            }
          }
        result.mcp =
          process.platform === 'win32'
            ? 'both portable and compatibility configs started using the bundled Windows runtime'
            : 'bundled Windows runtime and launcher files verified; startup is exercised on Windows';
      }
      packageSummary.push(result);
    }
    await cli(route.home, ['plugin', 'list', '--marketplace', routeCatalog.name, '--json']);
    summary.push({ route: route.route, candidate: route.candidate, packages: packageSummary });
  }
  console.log(
    JSON.stringify(
      { passed: true, githubTested: Boolean(githubRef), githubRef: githubRef ?? null, routes: summary },
      null,
      2,
    ),
  );
} finally {
  // mkdtemp owns this exact tree; never target an existing user Codex home.
  assert.equal(resolve(temporary), join(tmpdir(), temporary.split(/[\\/]/).at(-1)!));
  assert.ok(temporary.split(/[\\/]/).at(-1)!.startsWith('matsu-plugin-install-'));
  if (process.platform === 'win32')
    for (const runtimeDirectory of runtimeDirectories)
      for (const hash of await readdir(runtimeDirectory).catch(() => [])) {
        const runtimeNode = join(runtimeDirectory, hash, 'node.exe');
        const quotedNode = "'" + runtimeNode.replaceAll("'", "''") + "'";
        await execute(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${quotedNode} } | Stop-Process -Force`,
          ],
          { encoding: 'utf8', windowsHide: true },
        );
      }
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
