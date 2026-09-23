import assert from 'node:assert/strict';
import test from 'node:test';
import { registerContracts } from '../lib/contract-suite.mjs';
import { loadPlugin, pluginRoot } from '../lib/plugin.mjs';

await registerContracts(
  {
    name: 'expert-escalation',
    prefix: 'EX',
    implicit: true,
    agents: ['escalation-advisor', 'escalation-deep-advisor'],
    readOnly: ['escalation-advisor', 'escalation-deep-advisor'],
  },
  new URL('./contracts.json', import.meta.url),
);

await test('EX-U10: Escalation has no mandatory Workflow or MCP dependency', async () => {
  const { manifest, codex } = await loadPlugin(pluginRoot('expert-escalation'));
  assert.equal(manifest.dependencies, undefined);
  assert.equal(codex.mcpServers, undefined);
  assert.equal(codex.apps, undefined);
});
