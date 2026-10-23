import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { Tokens } from 'marked';
import { files, localLinks, markdown, read, stagePlugin, walkReferences } from '../lib/plugin.ts';

await test('WF-E01: isolated package discovers its Skill, role templates and complete document graph', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  assert.deepEqual([...plugin.skills.keys()].sort(), ['artifact-workflow', 'extension-management'].sort());
  assert.deepEqual([...plugin.agents.keys()], []);
  await localLinks(plugin.root, 'README.md');
  assert.ok(!(await readdir(plugin.root)).includes('node_modules'));
  const skill = plugin.skills.get('artifact-workflow')!;
  await localLinks(skill.root, 'assets/subagent-roles.md');
  const roleDocument = await read(join(skill.root, 'assets/subagent-roles.md'));
  assert.ok(roleDocument.includes('## artifact-worker'));
  assert.ok(roleDocument.includes('## artifact-reviewer'));
  assert.ok(roleDocument.includes('サブエージェントは親の依頼からモデル、推論設定、利用可能なツールを引き継ぐ'));
  assert.ok(roleDocument.includes('`spawn_agent` では子ごとに設定を上書きできない'));
  const reachable = await walkReferences(skill.root);
  assert.deepEqual(
    reachable,
    (await files(skill.root)).filter((file) => file.endsWith('.md')),
  );
  assert.equal(plugin.codex.mcpServers, './.mcp.json');
});

await test('WF-E02: all nine workflow steps reach their shipped instructions in order', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  const skill = plugin.skills.get('artifact-workflow')!;
  const sequence = markdown(skill.body).tokens.find(
    (token): token is Tokens.List => token.type === 'list' && token.ordered && token.items.length === 9,
  );
  assert.ok(sequence, 'Missing nine-step workflow');
  const expected = [
    ['タスク分解', 'references/task-planning.md'],
    ['計画の提示', 'assets/task-plan-template.md'],
    ['人間による承認', null],
    ['成果物の生成', 'references/generation.md'],
    ['セルフレビュー', 'references/self-review.md'],
    ['独立レビュー', 'references/independent-review.md'],
    ['タスクの完了条件の検証', 'references/verification.md'],
    ['全体検証', 'references/verification.md'],
    ['成果物の提示・引き渡しとフロー終了', 'references/delivery.md'],
  ];
  expected.forEach(([title, path], index) => {
    assert.ok(sequence.items[index]!.text.includes(`**${title}**`));
    if (path) assert.ok(markdown(sequence.items[index]!.text).links.includes(path), `Missing step reference: ${path}`);
  });
  const self = await localLinks(skill.root, 'references/self-review.md');
  assert.ok(self.includes('references/independent-review.md'));
  assert.ok(self.includes('references/review-principles.md'));
  const review = await localLinks(skill.root, 'references/independent-review.md');
  assert.ok(review.includes('references/review-principles.md'));
  assert.ok(review.includes('references/verification.md'));
  assert.ok(review.includes('references/escalation.md'));
});

await test('WF-E03: registered review selection keeps the common five principles outside the 0-3 module cap', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  const root = plugin.skills.get('artifact-workflow')!.root;
  const review = await read(join(root, 'references/independent-review.md'));
  assert.ok(review.includes('**0〜3個**'));
  assert.ok(review.includes('type: review'));
  assert.ok(review.includes('get_extension'));
  assert.ok(review.includes('同じ論点を複数指示に分けて上限を回避しない'));
  const common = await read(join(root, 'references/review-principles.md'));
  const principles = markdown(common).tokens.find((token): token is Tokens.Table => token.type === 'table');
  assert.ok(principles, 'Missing review principles');
  assert.equal(principles.rows.length, 5);
  assert.ok((await read(join(root, 'assets/subagent-roles.md'))).includes('0〜3個'));
  const management = plugin.skills.get('extension-management')!;
  assert.equal(management.settings.policy.allow_implicit_invocation, true);
  assert.ok(management.body.includes('成果物の生成・レビュー依頼では起動せず'));
});

await test('WF-E04: package alone has no hard dependency on an optional consultation plugin', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  assert.deepEqual(await readdir(join(plugin.root, '..')), ['artifact-workflow']);
  const skill = plugin.skills.get('artifact-workflow')!;
  const reachable = await walkReferences(skill.root);
  assert.ok(reachable.includes('references/escalation.md'), 'Optional consultation instructions must remain reachable');
});
