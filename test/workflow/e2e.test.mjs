import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { assertReadOnly } from '../lib/contract-suite.mjs';
import { files, localLinks, markdown, read, stagePlugin, walkReferences } from '../lib/plugin.mjs';

await test('WF-E01: isolated package discovers its Skill, roles and complete document graph', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  assert.deepEqual([...plugin.skills.keys()], ['artifact-workflow']);
  assert.deepEqual([...plugin.agents.keys()].sort(), ['artifact-reviewer', 'artifact-worker']);
  assertReadOnly(plugin.agents.get('artifact-reviewer'));
  assert.ok(!(await readdir(plugin.root)).includes('node_modules'));
  const skill = plugin.skills.get('artifact-workflow');
  const reachable = await walkReferences(skill.root);
  assert.deepEqual(
    reachable,
    (await files(skill.root)).filter((file) => file.endsWith('.md')),
  );
  assert.equal(plugin.codex.mcpServers, './.mcp.json');
});

await test('WF-E02: all nine workflow steps reach their shipped instructions in order', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  const skill = plugin.skills.get('artifact-workflow');
  const sequence = markdown(skill.body).tokens.find(
    (token) => token.type === 'list' && token.ordered && token.items.length === 9,
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
    assert.ok(sequence.items[index].text.includes(`**${title}**`));
    if (path) assert.ok(markdown(sequence.items[index].text).links.includes(path), `Missing step reference: ${path}`);
  });
  const self = await localLinks(skill.root, 'references/self-review.md');
  assert.ok(self.includes('references/independent-review.md'));
  assert.ok(self.includes('references/review-principles.md'));
  const review = await localLinks(skill.root, 'references/independent-review.md');
  assert.ok(review.includes('references/review-principles.md'));
  assert.ok(review.includes('references/verification.md'));
  assert.ok(review.includes('references/escalation.md'));
});

for (const selected of [[], ['security']]) {
  await test(`WF-E03: Independent Review documents with ${selected.length} specialized perspectives`, async (t) => {
    const plugin = await stagePlugin(t, 'artifact-workflow');
    const root = plugin.skills.get('artifact-workflow').root;
    const review = await read(join(root, 'references/independent-review.md'));
    const index = await read(join(root, 'references/review-perspectives/index.md'));
    assert.ok(review.includes('**0〜3個**'));
    assert.ok(index.includes('該当なしなら0個'));
    const common = await read(join(root, 'references/review-principles.md'));
    const principles = markdown(common).tokens.find((token) => token.type === 'table');
    assert.equal(principles.rows.length, 5);
    const indexLinks = await localLinks(root, 'references/review-perspectives/index.md');
    for (const id of selected) {
      const path = `references/review-perspectives/${id}.md`;
      assert.ok(indexLinks.includes(path));
      assert.ok((await localLinks(root, path)).includes('references/independent-review.md'));
    }
    assertReadOnly(plugin.agents.get('artifact-reviewer'));
    assert.ok(plugin.agents.get('artifact-reviewer').developer_instructions.includes('0〜3個'));
  });
}

await test('WF-E04: package alone has no hard dependency on an optional consultation plugin', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  assert.deepEqual(await readdir(join(plugin.root, '..')), ['artifact-workflow']);
  const skill = plugin.skills.get('artifact-workflow');
  const reachable = await walkReferences(skill.root);
  assert.ok(reachable.includes('references/escalation.md'), 'Optional consultation instructions must remain reachable');
});
