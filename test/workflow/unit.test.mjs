import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { registerContracts } from '../lib/contract-suite.mjs';
import { assertContract, inside, json, loadPlugin, pluginRoot, read } from '../lib/plugin.mjs';

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
  assert.equal(packageMetadata.version, manifest.version);
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
