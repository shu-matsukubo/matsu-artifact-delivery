import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { validateSkill } from '../../.agents/skills/plugin-skill-authoring/scripts/validate-skill.ts';
import { checkSkills, discoverSkills } from '../../scripts/check-skills.ts';
import { read, repository, temporaryDirectory, walkReferences } from '../lib/plugin.ts';

await test('DEV-U09: 10個すべての Skill の参照グラフを検査し棚卸しを維持する', async () => {
  const skillFiles = await discoverSkills(repository);
  assert.equal(skillFiles.length, 10, 'Skill inventory must include every development and distributable Skill');

  for (const skillFile of skillFiles) {
    const entry = relative(repository, skillFile).split(sep).join('/');
    await walkReferences(repository, entry);
  }

  const inventory = await read(join(repository, 'docs/skill-inventory.md'));
  for (const name of [
    'issue-development-workflow',
    'plugin-maintenance',
    'plugin-review',
    'plugin-skill-authoring',
    'artifact-workflow',
    'task-planning',
    'artifact-generation',
    'artifact-review',
    'extension-management',
    'expert-escalation',
  ])
    assert.ok(inventory.includes(name), `Skill inventory missing ${name}`);
});

await test('DEV-U10: 全Skill検査CLIが参照境界・欠落・異常時に失敗する', async (t) => {
  const root = await temporaryDirectory(t);
  const paths = ['.agents/skills/sample/SKILL.md', 'plugins/example/skills/demo/SKILL.md'];
  const skill = (name: string, link = '[方針](references/policy.md#guide)') =>
    [
      '---',
      `name: ${name}`,
      'description: サンプル Skill を検証するときに使う。',
      '---',
      '',
      '# Sample',
      '',
      '## 概要',
      '',
      '概要。',
      '',
      '## 制約',
      '',
      '- 制約。',
      '',
      '## フロー',
      '',
      `1. ${link}を使う。`,
      '',
    ].join('\n');
  for (const [path, name] of [
    [paths[0]!, 'sample'],
    [paths[1]!, 'demo'],
  ] as const) {
    const directory = join(root, path, '..');
    await mkdir(join(directory, 'references'), { recursive: true });
    await writeFile(join(directory, 'SKILL.md'), skill(name));
    await writeFile(join(directory, 'references/policy.md'), '# Guide\n');
  }
  assert.equal((await discoverSkills(root)).length, 2);
  assert.deepEqual(await checkSkills(root), []);
  const cli = join(repository, 'scripts/check-skills.ts');
  const success = execFileSync(process.execPath, [cli], { cwd: root, encoding: 'utf8' });
  assert.match(success, /2 件 OK/);

  const pluginSkill = join(root, paths[1]!);
  await writeFile(pluginSkill, skill('demo', '[外部](../../../.agents/skills/sample/SKILL.md)'));
  assert.match((await checkSkills(root)).join('\n'), /Path escapes package/);

  await writeFile(pluginSkill, skill('demo'));
  await writeFile(join(root, paths[0]!, '..', 'references/policy.md'), '# Other\n');
  assert.match((await checkSkills(root)).join('\n'), /Broken anchor/);

  await rm(join(root, paths[0]!));
  assert.match((await checkSkills(root)).join('\n'), /SKILL\.md を読み込めない/);

  assert.throws(
    () => execFileSync(process.execPath, [cli], { cwd: root, encoding: 'utf8' }),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 1);
      assert.match(String((error as { stderr?: string }).stderr), /SKILL\.md を読み込めない/);
      return true;
    },
  );
});

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

  const referenceLink = valid.replace(
    '1. [確認の方針](references/policy.md)に従う。',
    '1. [確認の方針][policy]に従う。\n\n[policy]: references/policy.md#方針',
  );
  await writeFile(skillFile, referenceLink);
  assert.deepEqual(await validateSkill(skillFile), []);

  await writeFile(skillFile, referenceLink.replace('#方針', '#missing'));
  assert.match((await validateSkill(skillFile)).join('\n'), /ローカルアンカー切れ/);

  await writeFile(
    skillFile,
    valid.replace('概要。', '概要。\n\n```md\n## 偽の見出し\n[偽リンク](references/missing.md)\n```'),
  );
  assert.deepEqual(await validateSkill(skillFile), []);

  await writeFile(skillFile, valid.replace('## フロー', '## 手順'));
  assert.match((await validateSkill(skillFile)).join('\n'), /対象外の第2見出し/);

  await writeFile(skillFile, valid.replace('## 制約と責務範囲', '## 制約'));
  assert.deepEqual(await validateSkill(skillFile), []);
});
