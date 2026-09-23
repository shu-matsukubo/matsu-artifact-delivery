import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { registerContracts } from '../lib/contract-suite.mjs';
import { assertContract, json, loadPlugin, pluginRoot, read } from '../lib/plugin.mjs';

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

await test('EX-U11: each advisor unit contract rejects removal of a required return field', async () => {
  const cases = await json(new URL('./contracts.json', import.meta.url));
  for (const id of ['EX-U08', 'EX-U09']) {
    const contract = cases.find((item) => item.id === id);
    const source = await read(join(pluginRoot('expert-escalation'), contract.file));
    const output = source.split(/\r?\n/).find((line) => line.startsWith('- 相談ID・受け取った親識別子'));
    assert.ok(output, 'Missing advisor return instruction');
    for (const field of [
      '相談ID',
      '受け取った親識別子',
      '役割',
      'advice',
      'input_insufficient',
      'inconclusive',
      'human_decision_required',
      '結論',
      '根拠と参照箇所',
      '前提',
      '未確認事項',
      '推奨対応と検証方法',
      '残るリスク',
      '人間判断の要否と理由',
      'を返す',
    ]) {
      assert.ok(output.includes(field), field);
      // Leave the same terms in the input instructions; the return clause itself must require them.
      const changed = source.replace(output, output.replace(field, ''));
      assert.throws(() => assertContract(changed, contract), new RegExp(`${id}: missing`), field);
    }
  }
});
