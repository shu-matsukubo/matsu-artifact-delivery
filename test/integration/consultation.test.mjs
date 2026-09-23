import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { assertReadOnly } from '../lib/contract-suite.mjs';
import { read, stagePlugin, walkReferences } from '../lib/plugin.mjs';

await test('INT-E01: installed optional Skill is discoverable and its return contract matches Workflow', async (t) => {
  const workflow = await stagePlugin(t, 'artifact-workflow');
  const escalation = await stagePlugin(t, 'expert-escalation');
  const consultation = escalation.skills.get('expert-escalation');
  const caller = await read(join(workflow.skills.get('artifact-workflow').root, 'references/escalation.md'));
  assert.ok(caller.includes(`\`${consultation.metadata.name}\``));
  assert.ok(caller.includes(`\`${escalation.manifest.name}:${consultation.metadata.name}\``));
  assert.equal(consultation.settings.policy.allow_implicit_invocation, true);
  await walkReferences(consultation.root);
  const callee = await read(join(consultation.root, 'references/advisor-contract.md'));
  for (const field of [
    '相談ID',
    '親識別子',
    'attempted',
    'execution_state',
    'input_insufficient',
    'unavailable',
    'no_result',
  ]) {
    assert.ok(caller.includes(field), `Workflow does not handle ${field}`);
    assert.ok(callee.includes(field), `Escalation does not provide ${field}`);
  }
  assert.ok(caller.includes('合計最大3回'));
  assert.ok(consultation.body.includes('累計の回数上限・リセット・自動再相談を持たない'));
});

await test('INT-E02: reviewer findings return through Parent to advisors, then back to the correct roles', async (t) => {
  const workflow = await stagePlugin(t, 'artifact-workflow');
  const escalation = await stagePlugin(t, 'expert-escalation');
  const reviewer = workflow.agents.get('artifact-reviewer');
  assertReadOnly(reviewer);
  assert.ok(reviewer.developer_instructions.includes('指摘・不足情報・エスカレーションが必要な論点はすべて親へ返す'));
  const caller = await read(join(workflow.skills.get('artifact-workflow').root, 'references/escalation.md'));
  assert.ok(caller.includes('発見元のレビュワーと修正担当のワーカーを区別'));
  assert.ok(caller.includes('生成・修正はワーカー、独立再レビューはレビュワー'));
  assert.ok(caller.includes('親が指摘の採否と通常の完了条件を判断する'));
  for (const advisor of escalation.agents.values()) {
    assertReadOnly(advisor);
    assert.ok(advisor.developer_instructions.includes('子ワーカーから直接依頼された場合は調査を始めず'));
    assert.ok(advisor.developer_instructions.includes('他のエージェント、相談役、別の Codex タスクを起動しない'));
  }
});
