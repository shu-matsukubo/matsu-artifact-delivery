// Optional release check: requires Codex CLI and repository development dependencies.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { repository } from './package-plugins.mjs';
import { validateManifests } from './validate-manifests.mjs';
import { files, json, localLinks } from '../test/lib/plugin.mjs';

const execute = promisify(execFile);
const requireMcp = createRequire(join(repository, 'plugins/artifact-workflow/package.json'));
const { Client } = await import(pathToFileURL(requireMcp.resolve('@modelcontextprotocol/client')));
const { StdioClientTransport, getDefaultEnvironment } = await import(
  pathToFileURL(requireMcp.resolve('@modelcontextprotocol/client/stdio'))
);
const args = process.argv.slice(2);
assert.ok(args.length <= 1 && !args[0]?.startsWith('-'), 'Usage: node scripts/test-install.mjs [marketplace-root]');
const source = resolve(args[0] ?? join(repository, 'dist'));
const temporary = await mkdtemp(join(tmpdir(), 'matsu-plugin-install-'));
const isolatedHome = join(temporary, 'codex-home');
const catalog = await json(join(source, '.agents/plugins/marketplace.json'));
const summary = [];
const cli = (args) =>
  execute(process.env.CODEX_CLI ?? 'codex', args, {
    cwd: temporary,
    env: { ...process.env, CODEX_HOME: isolatedHome },
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });

try {
  await mkdir(isolatedHome);
  await cli(['plugin', 'marketplace', 'add', source, '--json']);
  for (const entry of catalog.plugins) {
    assert.match(entry.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(entry.source.path, './plugins/' + entry.name);
    await cli(['plugin', 'add', entry.name + '@' + catalog.name, '--json']);
    const versionsRoot = join(isolatedHome, 'plugins/cache', catalog.name, entry.name);
    const versions = await readdir(versionsRoot);
    assert.equal(versions.length, 1, 'Expected one version in empty isolated home');
    const installed = join(versionsRoot, versions[0]);
    const expected = join(source, entry.source.path);
    await validateManifests(installed);
    const paths = await files(installed);
    assert.deepEqual(paths, await files(expected), 'Installed file list differs from package');
    let bytes = 0;
    for (const path of paths) {
      assert.ok(
        !path.split('/').some((part) => ['node_modules', '.build', '.test-build'].includes(part)),
        'Unexpected development directory: ' + path,
      );
      const contents = await readFile(join(installed, path));
      assert.deepEqual(contents, await readFile(join(expected, path)), 'Installed content differs: ' + path);
      bytes += contents.length;
      if (path.endsWith('.md')) await localLinks(installed, path);
    }
    const manifest = await json(join(installed, 'plugin.json'));
    const result = { name: entry.name, version: manifest.version, files: paths.length, bytes };
    if (entry.name === 'artifact-workflow') {
      for (const configName of ['mcp.json', '.mcp.json']) {
        const config = (await json(join(installed, configName))).mcpServers['artifact-task-memory'];
        const data = join(temporary, '日本語 data', configName);
        const expand = (value) =>
          value.replace(/\$\{(PLUGIN_ROOT|PLUGIN_DATA)\}/g, (_, key) => (key === 'PLUGIN_ROOT' ? installed : data));
        const client = new Client({ name: 'distribution-check', version: '1.0.0' });
        try {
          await client.connect(
            new StdioClientTransport({
              command: config.command,
              args: config.args.map(expand),
              cwd: temporary,
              env: {
                ...getDefaultEnvironment(),
                ...Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, expand(value)])),
              },
              stderr: 'pipe',
            }),
          );
          assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), [
            'complete_session',
            'get_plan',
            'reset_session',
            'save_plan',
          ]);
          const response = await client.callTool({ name: 'get_plan', arguments: { sessionId: 'distribution-check' } });
          assert.notEqual(response.isError, true);
          assert.deepEqual(response.structuredContent, { session: null });
        } finally {
          await client.close();
        }
      }
      result.mcp = 'both portable and compatibility configs started using Node alone';
    }
    summary.push(result);
  }
  await cli(['plugin', 'list', '--marketplace', catalog.name, '--json']);
  console.log(JSON.stringify({ passed: true, packages: summary }, null, 2));
} finally {
  // mkdtemp owns this exact tree; never target an existing user Codex home.
  assert.equal(resolve(temporary), join(tmpdir(), temporary.split(/[\\/]/).at(-1)));
  assert.ok(temporary.split(/[\\/]/).at(-1).startsWith('matsu-plugin-install-'));
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
