import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { registerContracts } from '../lib/contract-suite.ts';
import { json, loadPlugin, pluginRoot, read } from '../lib/plugin.ts';

import type { FileContract } from '../lib/types.ts';

await registerContracts(
  {
    name: 'expert-escalation',
    prefix: 'EX',
    implicit: true,
    agents: [],
    readOnly: [],
  },
  new URL('./contracts.json', import.meta.url),
);

await test('EX-U10: Escalation has no mandatory Workflow or MCP dependency', async () => {
  const { manifest, codex } = await loadPlugin(pluginRoot('expert-escalation'));
  assert.equal(manifest.dependencies, undefined);
  assert.equal(codex.mcpServers, undefined);
  assert.equal(codex.apps, undefined);
});

await test('EX-U11: advisor unit contract rejects removal of a required return field', async () => {
  const cases = await json<FileContract[]>(new URL('./contracts.json', import.meta.url));
  for (const id of ['EX-U08']) {
    const contract = cases.find((item) => item.id === id);
    assert.ok(contract, `Missing contract: ${id}`);
    const source = await read(join(pluginRoot('expert-escalation'), contract.file));
    const start = source.indexOf('## 相談役が返す結果');
    const end = source.indexOf('## 親が付ける呼び出しの状態', start);
    const output = source.slice(start, end);
    assert.ok(start >= 0 && end > start, 'Missing advisor return contract');
    const fields = [
      '相談ID',
      '親識別子',
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
    ];
    const returnsRequiredFields = (value: string) => fields.every((field) => value.includes(field));
    assert.ok(returnsRequiredFields(output), 'Missing advisor return fields');
    for (const field of fields) {
      assert.ok(output.includes(field), field);
      const changed = output.split(field).join('');
      assert.equal(returnsRequiredFields(changed), false, field);
    }
  }
});
