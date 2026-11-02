import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { files, localLinks, markdown, read, stagePlugin, walkReferences } from '../lib/plugin.ts';

const workflowSkills = ['artifact-workflow', 'task-planning', 'artifact-generation', 'artifact-review'];
const requiredSections = ['概要', '制約', 'フロー'];

await test('WF-E01: workflow entry and each Skill own their document graph and required structure', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  assert.deepEqual([...plugin.skills.keys()].sort(), [...workflowSkills, 'extension-management'].sort());
  assert.deepEqual([...plugin.agents.keys()], []);
  await localLinks(plugin.root, 'README.md');
  await localLinks(plugin.root, 'README.ja.md');
  assert.ok(!(await readdir(plugin.root)).includes('node_modules'));

  const markdownFiles = (await files(join(plugin.root, 'skills'))).filter((path) => path.endsWith('.md'));
  const workflowDocs = markdownFiles.map((path) => `skills/${path}`);
  assert.deepEqual(
    (await walkReferences(plugin.root, 'skills/artifact-workflow/SKILL.md')).toSorted(),
    workflowDocs.toSorted(),
  );

  for (const name of workflowSkills) {
    const start = `skills/${name}/SKILL.md`;
    const reachable = await walkReferences(plugin.root, start);
    const owned = markdownFiles.filter((path) => path.startsWith(`${name}/`)).map((path) => `skills/${path}`);
    for (const path of owned) assert.ok(reachable.includes(path), `Unreachable owned document: ${path}`);
    const body = (await read(join(plugin.root, start))).split('---').slice(2).join('---');
    const headings = markdown(body).tokens.filter(
      (token) => token.type === 'heading' && 'depth' in token && token.depth === 2,
    );
    assert.deepEqual(
      headings.map((token) => ('text' in token ? token.text : '')),
      requiredSections,
    );
    assert.equal(plugin.skills.get(name)?.settings.policy.allow_implicit_invocation, false);
  }

  const extension = plugin.skills.get('extension-management')!;
  assert.equal(extension.settings.policy.allow_implicit_invocation, true);
  const extensionBody = extension.body;
  const extensionHeadings = markdown(extensionBody).tokens.filter(
    (token) => token.type === 'heading' && 'depth' in token && token.depth === 2,
  );
  assert.deepEqual(
    extensionHeadings.map((token) => ('text' in token ? token.text : '')),
    requiredSections,
  );
  const extensionDocs = markdownFiles
    .filter((path) => path.startsWith('extension-management/'))
    .map((path) => `skills/${path}`);
  const extensionReachable = await walkReferences(plugin.root, 'skills/extension-management/SKILL.md');
  for (const path of extensionDocs) assert.ok(extensionReachable.includes(path), `Unreachable owned document: ${path}`);
  assert.equal(plugin.codex.mcpServers, './.mcp.json');
});

await test('WF-E02: workflow entry links planning, generation, review, verification and delivery', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  const links = await localLinks(plugin.root, 'skills/artifact-workflow/SKILL.md');
  for (const path of [
    'skills/task-planning/SKILL.md',
    'skills/artifact-generation/SKILL.md',
    'skills/artifact-review/SKILL.md',
    'skills/artifact-workflow/references/verification.md',
    'skills/artifact-workflow/references/delivery.md',
    'skills/artifact-workflow/references/task-memory.md',
  ])
    assert.ok(links.includes(path), `Missing workflow reference: ${path}`);
  const deliveryLinks = await localLinks(plugin.root, 'skills/artifact-workflow/references/delivery.md');
  assert.ok(
    deliveryLinks.includes('skills/extension-management/SKILL.md'),
    'Missing completion proposal management route',
  );
  assert.ok(!(await files(join(plugin.root, 'skills'))).some((path) => path.includes('self-review')));
});

await test('WF-E03: reviewer applies the common policy fixed in the approved plan', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  assert.deepEqual([...plugin.agents.keys()], [], 'Reviewer must not depend on a registered Plugin Agent');
  const root = join(plugin.root, 'skills/artifact-review');
  const review = await read(join(root, 'references/independent-review.md'));
  assert.ok(review.includes('共通方針0〜1件'));
  assert.ok(review.includes('同じ本文・revision'));
  const common = await read(join(root, 'references/review-principles.md'));
  const principles = markdown(common).tokens.find((token) => token.type === 'table');
  assert.ok(
    principles && 'rows' in principles && principles.rows.length === 5,
    'Missing five common review principles',
  );
  const reviewer = await read(join(root, 'assets/reviewer.md'));
  assert.ok(reviewer.includes('共通5原則はすべて適用する'));
  assert.ok(reviewer.includes('方針を独自に追加・差し替えない'));
  assert.ok(reviewer.includes('親が書き込み可能でもこの指示のもとでレビューする'));
  assert.ok(reviewer.includes('確認した対象版と、レビュー範囲内のファイル一覧・SHA-256 を返却する'));
  assert.ok(review.includes('`spawn_agent` で生成・修正担当とは別の標準 subagent を起動'));
  assert.ok(review.includes('Custom Agent の事前登録は要求しない'));
  assert.ok(
    review.includes(
      '子専用の読み取り専用 Sandbox を設定できないことや、親が書き込み可能なことだけを理由にレビューを保留しない',
    ),
  );
  assert.ok(review.includes('技術的な読み取り専用の強制を明示的に必須としている場合'));
  assert.ok(review.includes('設定できなければ通常レビューに切り替えず、未実施の理由を親へ返す'));
  assert.ok(review.includes('レビュー前後に対象範囲のファイル一覧・追加・削除・各 SHA-256'));
  assert.ok(review.includes('staged / unstaged / untracked の開始状態からの増分も照合する'));
  assert.ok(review.includes('これらは変更を事後に検知する照合であり、書き込みを防ぐ権限の保証ではない'));
  assert.ok(review.includes('変更の有無を検証できない場合も成功扱いしない'));
  const extension = plugin.skills.get('extension-management')!;
  assert.ok(extension.body.includes('計画・worker・reviewer・承認ゲートを起動しない'));
});

await test('WF-E04: package alone has no hard dependency on an optional consultation plugin', async (t) => {
  const plugin = await stagePlugin(t, 'artifact-workflow');
  assert.deepEqual(await readdir(join(plugin.root, '..')), ['artifact-workflow']);
  const reachable = await walkReferences(plugin.root, 'skills/artifact-workflow/SKILL.md');
  assert.ok(
    reachable.includes('skills/artifact-workflow/references/escalation.md'),
    'Optional consultation instructions must remain reachable',
  );
});
