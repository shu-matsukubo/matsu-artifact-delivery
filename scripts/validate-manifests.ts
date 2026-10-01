import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import type { CodexManifest, McpManifest, PluginManifest } from './manifest-types.ts';

const repository = fileURLToPath(new URL('../', import.meta.url));
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8'));
const ajv = new Ajv2020({ allErrors: true });
const validators = new Map<string, { id: string; validate: ValidateFunction }>();
for (const kind of ['plugin', 'mcp']) {
  const schema = await readJson<{ $id: string }>(
    join(repository, 'test/schemas/agent-plugins-1.0.0/' + kind + '.schema.json'),
  );
  validators.set(kind, { id: schema.$id, validate: ajv.compile(schema) });
}

export function validatePortable(document: unknown, kind: 'plugin'): asserts document is PluginManifest;
export function validatePortable(document: unknown, kind: 'mcp'): asserts document is McpManifest;
export function validatePortable(document: unknown, kind: 'plugin' | 'mcp') {
  assert.ok(document && typeof document === 'object' && !Array.isArray(document), kind + ' schema: expected an object');
  const { id, validate } = validators.get(kind)!;
  const schema = '$schema' in document ? document.$schema : undefined;
  assert.equal(schema, id, 'Unsupported ' + kind + ' schema: ' + schema);
  assert.ok(validate(document), kind + ' schema: ' + ajv.errorsText(validate.errors, { separator: '; ' }));
}

async function packagePath(root: string, path: string, directory = false) {
  assert.equal(typeof path, 'string', 'Package path must be a string');
  const difference = relative(root, resolve(root, path));
  assert.ok(
    !isAbsolute(path) &&
      !win32.isAbsolute(path) &&
      difference !== '..' &&
      !difference.startsWith('..' + sep) &&
      !isAbsolute(difference),
    'Path escapes package: ' + path,
  );
  const parts = difference.split(sep).filter(Boolean);
  for (let index = 1; index <= parts.length; index++) {
    const info = await lstat(join(root, ...parts.slice(0, index)));
    assert.ok(!info.isSymbolicLink(), 'Symlink in package path: ' + path);
    if (index === parts.length)
      assert.ok(directory ? info.isDirectory() : info.isFile(), 'Invalid package path: ' + path);
  }
}

export async function validateManifests(root: string) {
  const manifest = await readJson(join(root, 'plugin.json'));
  validatePortable(manifest, 'plugin');
  const codex = await readJson<CodexManifest>(join(root, '.codex-plugin/plugin.json'));
  // Codex compatibility is a separate contract, not a portable schema instance.
  const identity = [
    'name',
    'version',
    'description',
    'author',
    'license',
    'homepage',
    'repository',
    'keywords',
  ] as const;
  const allowed = new Set<string>([...identity, 'id', 'skills', 'apps', 'mcpServers', 'interface']);
  for (const key of Object.keys(codex)) assert.ok(allowed.has(key), 'Unsupported Codex field: ' + key);
  for (const key of identity) assert.deepEqual(codex[key], manifest[key], 'Inconsistent manifest ' + key);
  assert.equal(codex.skills, './skills/');
  await packagePath(root, codex.skills, true);
  let mcp;
  try {
    mcp = await readJson(join(root, 'mcp.json'));
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  if (mcp !== undefined) {
    validatePortable(mcp, 'mcp');
    assert.equal(
      mcp.$schema.replace('mcp.schema.json', 'plugin.schema.json'),
      manifest.$schema,
      'Schema versions differ',
    );
    assert.equal(codex.mcpServers, './.mcp.json');
    await packagePath(root, codex.mcpServers);
    assert.deepEqual(
      await readJson(join(root, codex.mcpServers)),
      { mcpServers: mcp.mcpServers },
      'Inconsistent MCP compatibility config',
    );
    // Repository runtime contract supplements schema syntax with real paths.
    assert.deepEqual(Object.keys(mcp.mcpServers), ['artifact-task-memory']);
    const server = mcp.mcpServers['artifact-task-memory']!;
    assert.equal(server.type, 'stdio');
    assert.equal(server.command, 'powershell.exe');
    assert.deepEqual(server.args, [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      '${PLUGIN_ROOT}/mcp/start.ps1',
    ]);
    assert.deepEqual(server.env, { ARTIFACT_WORKFLOW_DATA_DIR: '${PLUGIN_DATA}/task-memory' });
    await packagePath(root, server.args.at(-1)!.slice('${PLUGIN_ROOT}/'.length));
    for (const runtimeFile of [
      'mcp/task-memory.cjs',
      'mcp/node-win-x64.zip',
      'mcp/node-runtime.json',
      'mcp/NODE_RUNTIME_LICENSES.txt',
      'mcp/start.ps1',
    ])
      await packagePath(root, runtimeFile);
    if (server.cwd) {
      assert.ok(!server.cwd.startsWith('${PLUGIN_DATA}'), 'Repository MCP must not require a pre-existing data cwd');
      await packagePath(root, server.cwd.replace(/^\$\{PLUGIN_ROOT\}\/?/, './'), true);
    }
  } else {
    assert.equal(codex.mcpServers, undefined, 'MCP compatibility config has no portable source');
  }
  return { manifest, codex };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 2, 'Usage: node scripts/validate-manifests.ts');
  for (const name of ['artifact-workflow', 'expert-escalation']) {
    await validateManifests(join(repository, 'plugins', name));
    console.log('Validated portable and Codex configuration: ' + name);
  }
}
