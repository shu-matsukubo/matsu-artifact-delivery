import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { validateSkill } from '../../.agents/skills/plugin-skill-authoring/scripts/validate-skill.ts';
import { read, repository, temporaryDirectory } from '../lib/plugin.ts';

await test('DEV-U07: Skill 作成・修正とレビューが共通規約を使用する', async () => {
  const skillPath = '.agents/skills/plugin-skill-authoring/SKILL.md';
  assert.deepEqual(await validateSkill(join(repository, skillPath)), []);

  for (const path of [
    '.agents/skills/plugin-maintenance/references/implementation.md',
    '.agents/skills/plugin-review/references/review-checklist.md',
  ]) {
    const content = await read(join(repository, path));
    assert.match(content, /\[Plugin Skill の作成・検証\]\(\.\.\/\.\.\/plugin-skill-authoring\/SKILL\.md\)を使/);
  }

  const policy = await read(join(repository, '.agents/skills/plugin-skill-authoring/references/design-policy.md'));
  for (const term of ['AGENTS.md', 'SKILL.md', 'references/', 'docs/', 'assets/', 'scripts/']) {
    assert.ok(policy.includes(term), `Missing policy for ${term}`);
  }
});

await test('DEV-U08: Skill 構造検証が正しい構造を受理し、不正な構造とリンクを拒否する', async (t) => {
  const root = await temporaryDirectory(t);
  const directory = join(root, 'sample');
  await mkdir(join(directory, 'references'), { recursive: true });
  await writeFile(join(directory, 'references', 'policy.md'), '# 方針\n');

  const skillFile = join(directory, 'SKILL.md');
  const valid = [
    '---',
    'name: sample',
    'description: サンプル Skill を検証するときに使う。',
    '---',
    '',
    '# Sample',
    '',
    '## 概要',
    '',
    '概要。',
    '',
    '## 制約と責務範囲',
    '',
    '- 一文一責務。',
    '',
    '## フロー',
    '',
    '1. [確認の方針](references/policy.md)に従う。',
    '',
  ].join('\n');
  await writeFile(skillFile, valid);
  assert.deepEqual(await validateSkill(directory), []);

  await writeFile(skillFile, valid.replace('name: sample', 'name: wrong'));
  assert.match((await validateSkill(skillFile)).join('\n'), /name はディレクトリ名/);

  await writeFile(skillFile, valid.replace('references/policy.md', 'references/missing.md'));
  assert.match((await validateSkill(skillFile)).join('\n'), /ローカルリンク切れ/);

  await writeFile(skillFile, valid.replace('## フロー', '## 手順'));
  assert.match((await validateSkill(skillFile)).join('\n'), /対象外の第2見出し/);
});
