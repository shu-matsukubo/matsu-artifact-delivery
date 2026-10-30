import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import {
  files,
  frontmatter,
  inside,
  json,
  assertContract,
  loadPlugin,
  localLinks,
  read,
  repository,
  stagePlugin,
} from '../lib/plugin.ts';

import type { Marketplace, PackageMetadata } from '../../scripts/manifest-types.ts';
import type { FileContract } from '../lib/types.ts';

await test('PKG-U01: marketplace discovers every package with matching metadata and local paths', async () => {
  const catalog = await json<Marketplace>(join(repository, '.agents/plugins/marketplace.json'));
  assert.match(catalog.name, /^[A-Za-z0-9_-]+$/);
  assert.ok(catalog.interface.displayName);
  const names = catalog.plugins.map((entry) => entry.name).sort();
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, (await readdir(join(repository, 'plugins'))).sort());
  for (const entry of catalog.plugins) {
    assert.equal(entry.source.source, 'local');
    assert.equal(entry.source.path, `./plugins/${entry.name}`);
    assert.ok(['NOT_AVAILABLE', 'AVAILABLE', 'INSTALLED_BY_DEFAULT'].includes(entry.policy.installation));
    assert.ok(['ON_INSTALL', 'ON_USE'].includes(entry.policy.authentication));
    assert.ok(entry.category);
    const plugin = await loadPlugin(inside(repository, entry.source.path));
    assert.equal(plugin.manifest.name, entry.name);
    assert.equal(await read(join(plugin.root, 'LICENSE')), await read(join(repository, 'LICENSE')));
  }
});

await test('PKG-U02: project Codex settings stay outside packages; prompt roles need no Custom Agent registration', async (t) => {
  const catalog = await json<Marketplace>(join(repository, '.agents/plugins/marketplace.json'));
  await access(join(repository, '.codex/config.toml'));
  for (const entry of catalog.plugins) {
    const plugin = await stagePlugin(t, entry.name);
    assert.deepEqual([...plugin.agents.keys()], []);
    const packagedFiles = await files(plugin.root);
    assert.ok(
      !packagedFiles.some((path) => path.startsWith('.codex/')),
      `Repository Codex settings must not be packaged: ${entry.name}`,
    );
  }
});

await test('PKG-U03: Plugin documentation resolves local links and explains reviewer permissions', async (t) => {
  for (const path of [
    'AGENTS.md',
    'README.md',
    'README.ja.md',
    ...(await readdir(join(repository, 'docs'))).filter((path) => path.endsWith('.md')).map((path) => `docs/${path}`),
    'plugins/artifact-workflow/README.md',
    'plugins/artifact-workflow/README.ja.md',
    'plugins/expert-escalation/README.md',
    'plugins/expert-escalation/README.ja.md',
  ])
    await localLinks(repository, path);

  for (const name of ['artifact-workflow', 'expert-escalation']) {
    const plugin = await stagePlugin(t, name);
    const packagedFiles = await files(plugin.root);
    assert.ok(packagedFiles.includes('README.ja.md'), `${name} package must include the Japanese README`);
    await localLinks(plugin.root, 'README.md');
    await localLinks(plugin.root, 'README.ja.md');
  }

  for (const path of await files(join(repository, '.agents/skills'))) {
    if (!path.endsWith('.md')) continue;
    const fullPath = `.agents/skills/${path}`;
    await localLinks(repository, fullPath);
    if (path.endsWith('/SKILL.md')) {
      const { metadata } = frontmatter(await read(join(repository, fullPath)));
      assert.equal(metadata.name, path.split('/')[0]);
    }
  }

  const workflowReadme = await read(join(repository, 'plugins/artifact-workflow/README.md'));
  assert.ok(
    workflowReadme.includes('Reviewer instructions request read-only work but do not change runtime permissions'),
  );
});

await test('PKG-U04: all contract IDs and runnable suites appear in the test inventory', async () => {
  // Guide-only changes select infrastructure, not the Workflow / Escalation units.
  const docs = await read(join(repository, 'docs/testing.md'));
  for (const suite of ['workflow', 'escalation']) {
    for (const contract of await json<FileContract[]>(join(repository, `test/${suite}/contracts.json`)))
      assert.ok(docs.includes(contract.id), `Undocumented ${contract.id}`);
  }
  const { scripts } = await json<PackageMetadata>(join(repository, 'package.json'));
  for (const command of ['test:workflow', 'test:escalation', 'test:integration', 'test:infrastructure', 'test:mcp']) {
    assert.ok(scripts[command], `Missing command: ${command}`);
    assert.ok(docs.includes(command), `Undocumented ${command}`);
  }
});

await test('DEV-U01: 単体の開発 Workflow が再開・環境準備・反映契約と担当境界を維持する', async () => {
  const skillPath = '.agents/skills/issue-development-workflow';
  const { metadata, body } = frontmatter(await read(join(repository, skillPath, 'SKILL.md')));
  assert.equal(metadata.name, 'issue-development-workflow');
  assert.match(metadata.description, /Issue.*PR 作成/);

  const references = [
    'resume.md',
    'issue-selection.md',
    'workspace-setup.md',
    'implementation-review.md',
    'publish-pr.md',
  ].map((name) => `${skillPath}/references/${name}`);
  const entryLinks = await localLinks(repository, `${skillPath}/SKILL.md`);
  for (const reference of references) assert.ok(entryLinks.includes(reference));
  assert.ok(entryLinks.includes('docs/git-workflow.md'));
  for (const reference of references) await localLinks(repository, reference);
  const [resume, selection, workspace, implementation, publish] = await Promise.all([
    read(join(repository, references[0]!)),
    read(join(repository, references[1]!)),
    read(join(repository, references[2]!)),
    read(join(repository, references[3]!)),
    read(join(repository, references[4]!)),
  ]);
  const all = [body, resume, selection, workspace, implementation, publish].join('\n');
  assert.doesNotMatch(all, /作業ディレクトリ外の永続的な作業記録|記録を保存できない場合は停止/);
  assert.doesNotMatch(all, /開始前と各段階の前後.*記録|完了記録|記録の base branch|記録したコミット SHA/);

  assert.doesNotMatch(all, /フォールバックせず停止|GitHub Plugin を前提/);
  assert.match(body, /独自の状態ファイルやチェックポイントファイル.*作成・永続化しない/);
  assert.match(body, /状態管理用のラベルは追加しない/);
  assert.match(body, /実行結果や中断内容は同一スレッドで報告/);

  assert.ok(resume.includes('新規 Issue の処理前'));
  assert.match(resume, /同一スレッドの過去の会話・実行ログ.*前回実行時の結果や中断内容.*Memory.*補助情報/);
  assert.match(resume, /状態の正本ではなく/);
  assert.match(resume, /過去ログや Memory 等が利用できないこと自体をエラーや停止理由にしない/);
  assert.match(resume, /GitHub とローカル workspace の現在状態を最終的な判断材料/);
  for (const requirement of [
    '新規 Issue の処理前',
    '利用可能な補助情報',
    '選択した手段で取得した Issue・PR・branch・commit',
    'ローカル HEAD・branch・worktree および staged / unstaged / untracked',
    '未完了作業を判定する',
  ])
    assert.ok(resume.includes(requirement), `DEV-U01: missing resume check ${requirement}`);
  assert.match(resume, /制限到達、エラー、その他の中断/);
  const identifyIssue = resume.indexOf('過去ログ等と現在状態から Open Issue');
  const resumeKnownWork = resume.indexOf('特定した作業は新しい Issue を選ばず');
  assert.ok(identifyIssue >= 0 && resumeKnownWork > identifyIssue);
  for (const requirement of ['branch、workspace、差分を安全に一意に特定', '未完了の段階から再開'])
    assert.ok(resume.includes(requirement), `DEV-U01: missing resume rule ${requirement}`);
  assert.match(resume, /確認できた既存ブランチのみ再利用/);
  assert.match(resume, /その作業によるローカル変更を利用/);
  assert.match(resume, /現在の差分に対する検証・レビュー完了を確認できなければ.*\(implementation-review\.md\).*戻す/);
  assert.ok(resume.includes('## 作業を特定できない場合'));
  assert.ok(resume.includes('ローカル workspace の branch と staged / unstaged / untracked の差分を確認する'));
  assert.match(resume, /clean.*未完了作業を示す Issue branch 等がなければ.*新規 Issue の選定/);
  assert.match(resume, /変更がある場合は由来を推測せず、人間による確認が必要と報告して停止/);
  assert.match(resume, /base branch・起点 SHA と既存の作業ツリーを引き継ぐ/);
  assert.match(resume, /全段階で異常状態は自動修復しない/);
  assert.match(resume, /`reset`.*`checkout`.*`restore`.*`stash`.*`clean`.*未追跡ファイルの削除.*行わない/);
  assert.match(resume, /PR が作成済み.*base・head.*差分が検証・レビュー済みの作業と一致.*レビュー待ちとして終了/);

  assert.match(selection, /対象 Issue がない場合は終了/);
  assert.match(resume, /指定 Issue.*別の Issue.*再開しない/);
  assert.match(resume, /git branch --show-current.*git remote -v.*git status --short --untracked-files=all/);
  assert.match(resume, /競合.*Git 操作中.*停止/);
  assert.match(resume, /新規開始.*正当に特定した再開作業には適用しない/);

  assert.match(workspace, /選択した手段.*default branch とその最新コミット SHA/);
  assert.match(workspace, /Codex のユーザー設定から branch prefix を取得/);
  assert.match(workspace, /取得できない場合は `codex` を使い/);
  assert.ok(workspace.includes('取得した SHA を起点に'));
  assert.ok(workspace.includes('隔離 worktree'));
  assert.match(workspace, /前回の branch やローカル HEAD、未マージまたは破棄済みの作業を引き継がない/);
  assert.match(workspace, /用意できない場合は停止し、環境準備が必要だと報告する/);
  assert.match(workspace, /<prefix>\/issue\/<Issue 番号>/);
  assertContract(workspace, {
    id: 'DEV-U01',
    ordered: ['git fetch <remote> <default branch>', 'git worktree add -b', '作業ツリー内で', 'git rev-parse HEAD'],
  });
  assert.ok(workspace.includes('元の checkout の外にある未使用パス'));
  const createdWorktreeChecks = workspace.slice(workspace.indexOf('作業ツリー内で'));
  for (const command of ['git branch --show-current', 'git remote -v', 'git status --short --untracked-files=all'])
    assert.ok(createdWorktreeChecks.includes(command), `DEV-U01: missing worktree check ${command}`);
  assert.match(workspace, /git rev-parse HEAD.*起点 SHA.*一致.*clean.*実装/);
  assert.match(workspace, /同名のローカル・リモート branch.*再利用・上書きせず停止/);
  assert.match(workspace, /既存ブランチの再利用は.*正当に特定された再開作業に限る/);

  assert.match(implementation, /issue-implementer\.toml.*委任する/);
  assert.match(implementation, /担当.*GPT-6 Luna \/ reasoning medium/);
  assert.match(implementation, /親.*GPT-6\.1 Sol \/ reasoning xhigh/);
  assert.match(implementation, /指摘を実装担当へ戻し、解消までレビューを繰り返す/);

  assertContract(publish, {
    id: 'DEV-U01',
    ordered: [
      'git diff --cached',
      'git commit --no-gpg-sign',
      'git diff <起点 SHA> HEAD',
      '## リモートブランチ作成',
      'git push --no-follow-tags --no-signed <remote> HEAD:refs/heads/<Issue 用ブランチ>',
      'リモート branch を再取得',
      'git status --short --untracked-files=all',
      'Issue を参照する Open PR を作成',
    ],
  });
  assert.match(publish, /`git add.*検証・レビュー済みの変更だけをステージ.*`git commit --no-gpg-sign -m/s);
  assert.match(publish, /コミットでは `--no-gpg-sign`、Push では `--no-signed`/);
  assert.match(publish, /Git と GitHub の操作.*docs\/git-workflow\.md/);
  const gitSafety = await read(join(repository, 'docs/git-workflow.md'));
  assert.match(gitSafety, /git remote get-url --push --all <remote>.*URL が一件.*対象リポジトリ/);
  assert.match(gitSafety, /保護ブランチへの直接コミット・Push・マージ.*強制 Push.*削除.*既存変更を失わせる操作/s);
  assert.match(
    publish,
    /コミット後と再開時.*git diff <起点 SHA> HEAD.*検証・レビュー済みの差分と一致.*不一致なら Push せず/,
  );
  assert.match(publish, /新規 branch.*起点 SHA.*GitHub 手段で作成.*同名なら停止/);
  assert.match(publish, /再開.*一意に特定した既存 branch.*この工程で作成したリモート branch だけを再利用/s);
  assert.match(publish, /現在の branch と Push 先が当該 Issue branch.*確認できたときだけ/s);
  assert.match(publish, /反映結果を確認できない場合も同様/);
  assert.match(publish, /staged、unstaged、untracked file.*clean/);
  assert.match(publish, /不一致、失敗、レビュー対象外の変更.*変更の保全.*停止し、PR を作成・更新しない/);
  assert.match(publish, /base は開始時の default branch、head は Issue branch/);
  assert.match(publish, /`Closes`、`Fixes`、`Resolves` 等の Issue closing keyword を含めない/);
  assert.match(publish, /PR の merge と Issue の Close は別のライフサイクル/);
  assert.match(publish, /Issue はこの Skill では閉じず、人間が必要な確認を終えた後に閉じる/);

  const codex = parseToml(await read(join(repository, '.codex/config.toml'))) as {
    model: string;
    model_reasoning_effort: string;
  };
  const implementer = parseToml(await read(join(repository, '.codex/agents/issue-implementer.toml'))) as {
    model: string;
    model_reasoning_effort: string;
  };
  assert.deepEqual([codex.model, codex.model_reasoning_effort], ['gpt-6.1-sol', 'xhigh']);
  assert.deepEqual([implementer.model, implementer.model_reasoning_effort], ['gpt-6-luna', 'medium']);
});

await test('DEV-U02: 指定 Issue の依頼範囲と、明示要求時の対象選定を守る', async () => {
  const selection = await read(
    join(repository, '.agents/skills/issue-development-workflow/references/issue-selection.md'),
  );
  assert.match(selection, /Issue が指定.*Open.*確認/);
  assert.match(selection, /指定 Issue.*ラベル.*要求しない/);
  assert.match(selection, /対象 Issue の選定を明示的に依頼.*`AI処理可能` ラベル付きの Open Issue/);
  assert.match(selection, /プラグインの新規作成・修正に該当する候補だけを対象/);
  assert.match(selection, /インフラ、CI、リポジトリ文書のみの Issue は対象外/);
  assert.match(selection, /関連付けられた実装 PR を、ブランチ名にかかわらず確認/);
  assert.match(selection, /Open の実装 PR がある候補.*merge 済みの実装 PR があり人間の Close 待ちの候補は除外/);
  assert.match(selection, /内容、優先度、依存関係、実装可能性を判断して一件選ぶ/);
  assert.match(selection, /固定の priority ラベルは要求しない/);

  const implementer = parseToml(await read(join(repository, '.codex/agents/issue-implementer.toml'))) as {
    developer_instructions: string;
  };
  assert.match(implementer.developer_instructions, /親が指定した変更依頼と担当範囲/);
  assert.match(implementer.developer_instructions, /レビュー、GitHub PR 作成、対象 Issue の選定は行わない/);
});

await test('DEV-U03: Issue の対象範囲に応じた実装・レビュー手順が入口と担当エージェントで一致する', async () => {
  const implementation = await read(
    join(repository, '.agents/skills/issue-development-workflow/references/implementation-review.md'),
  );
  const links = await localLinks(
    repository,
    '.agents/skills/issue-development-workflow/references/implementation-review.md',
  );
  for (const path of [
    '.agents/skills/plugin-maintenance/SKILL.md',
    '.agents/skills/plugin-review/SKILL.md',
    'AGENTS.md',
    'docs/manufacturing-review.md',
    'docs/testing-review.md',
  ]) {
    assert.ok(links.includes(path), `DEV-U03: missing scope guidance ${path}`);
  }
  assert.match(implementation, /プラグイン変更:.*plugin-maintenance.*plugin-review/);
  assert.match(implementation, /インフラ・CI・リポジトリ文書のみ:.*AGENTS\.md.*製造・レビュー観点.*テスト・検証観点/);
  assert.match(implementation, /混在変更:.*範囲ごとの手順.*依存先を含め変更全体.*レビュー/);

  const implementer = parseToml(await read(join(repository, '.codex/agents/issue-implementer.toml'))) as {
    description: string;
    developer_instructions: string;
  };
  assert.match(implementer.developer_instructions, /プラグインの新規作成・修正に関わる範囲.*plugin-maintenance/);
  assert.match(
    implementer.developer_instructions,
    /インフラ、CI、リポジトリ文書のみ.*AGENTS\.md.*docs\/manufacturing-review\.md.*docs\/testing-review\.md/,
  );
  assert.match(implementer.developer_instructions, /混在.*対象範囲ごと/);
  assert.doesNotMatch(implementer.description, /plugin-maintenance を使い/);

  const skill = await read(join(repository, '.agents/skills/issue-development-workflow/SKILL.md'));
  const design = await read(join(repository, 'docs/codex-workflows.md'));
  assert.doesNotMatch([skill, design].join('\n'), /実装(?:とレビュー)?は.*plugin-maintenance.*委ねる/);
});

await test('DEV-U06: 通常の変更依頼は Workflow で製造・レビューし、Issue 選定は明示要求時に限る', async () => {
  const maintenancePath = '.agents/skills/plugin-maintenance';
  const maintenancePolicy = parseYaml(await read(join(repository, maintenancePath, 'agents/openai.yaml'))) as {
    policy?: { allow_implicit_invocation?: boolean };
  };
  assert.equal(maintenancePolicy.policy?.allow_implicit_invocation, false);

  const review = await read(join(repository, '.agents/skills/plugin-review/SKILL.md'));
  assert.match(frontmatter(review).metadata.description, /レビュー/);

  const clarificationPath = '.agents/skills/issue-development-workflow/references/spec-clarification.md';
  const clarification = await read(join(repository, clarificationPath));
  assert.match(clarification, /依頼内容、既存の仕様・資料、関係するコードを読み/);
  assert.match(clarification, /曖昧さ、矛盾、判断待ち.*質問/);
  assert.match(clarification, /回答を受けたら仕様を再確認/);
  assert.match(clarification, /回答が揃うまで.*設計、タスク分解、実装を始めず/);
  assert.match(clarification, /新たな仕様上の疑問.*該当箇所を止めて確認/);
  assert.match(clarification, /仕様を変えない技術的な判断は AI が行う/);
  assert.match(clarification, /仕様が明確なら質問を追加せず/);
  assert.match(clarification, /未確定の仕様に依存する結論は保留/);
  for (const [path, content] of [
    [
      '.agents/skills/issue-development-workflow/SKILL.md',
      await read(join(repository, '.agents/skills/issue-development-workflow/SKILL.md')),
    ],
    [
      '.agents/skills/plugin-maintenance/SKILL.md',
      await read(join(repository, '.agents/skills/plugin-maintenance/SKILL.md')),
    ],
    ['.agents/skills/plugin-review/SKILL.md', review],
  ] as const) {
    const links = await localLinks(repository, path);
    assert.ok(links.includes(clarificationPath), `Missing specification guidance link in ${path}`);
    assert.ok(content.includes('仕様の明確化'));
  }

  const workflowPath = '.agents/skills/issue-development-workflow';
  const workflow = await read(join(repository, `${workflowPath}/SKILL.md`));
  assert.match(frontmatter(workflow).metadata.description, /具体的な変更依頼/);
  assert.match(workflow, /Issue が未指定の具体的な変更依頼では.*別の Issue を選ばず/);
  assert.match(workflow, /Issue 未指定の具体的な変更依頼は.*implementation-review\.md.*へ進む/);
  assert.match(workflow, /新規開始時は.*workspace-setup\.md.*準備/);
  assert.match(workflow, /再開・新規を問わず.*implementation-review\.md/);
  const workflowLinks = await localLinks(repository, `${workflowPath}/SKILL.md`);
  for (const reference of [
    'resume.md',
    'issue-selection.md',
    'workspace-setup.md',
    'implementation-review.md',
    'publish-pr.md',
  ])
    assert.ok(workflowLinks.includes(`${workflowPath}/references/${reference}`));
  assertContract(workflow.slice(workflow.indexOf('Issue が指定された依頼')), {
    id: 'DEV-U06',
    ordered: ['resume.md', 'issue-selection.md', 'workspace-setup.md', 'implementation-review.md', 'publish-pr.md'],
  });
  for (const skillPath of [workflowPath, '.agents/skills/plugin-review']) {
    const skillFiles = await files(join(repository, skillPath));
    if (skillFiles.includes('agents/openai.yaml')) {
      const settings = parseYaml(await read(join(repository, skillPath, 'agents/openai.yaml'))) as {
        policy?: { allow_implicit_invocation?: boolean };
      };
      assert.ok([undefined, true].includes(settings.policy?.allow_implicit_invocation));
    }
  }
  const implementation = await read(join(repository, `${workflowPath}/references/implementation-review.md`));
  assertContract(implementation, {
    id: 'DEV-U06',
    ordered: ['委任メッセージに含める', 'リテラルの `$plugin-maintenance`', 'issue-implementer.toml', '委任する'],
  });
  assert.match(implementation, /plugin-maintenance.*plugin-review/);
  assert.match(implementation, /実装.*レビュー/);
  assert.ok(implementation.indexOf('plugin-maintenance') < implementation.indexOf('plugin-review'));
  assert.ok(implementation.includes('プラグイン変更ではリテラルの `$plugin-maintenance`'));

  const implementer = parseToml(await read(join(repository, '.codex/agents/issue-implementer.toml'))) as {
    developer_instructions: string;
  };
  assert.match(implementer.developer_instructions, /プラグイン.*\$plugin-maintenance.*明示的に使う/);

  const selection = await read(join(repository, `${workflowPath}/references/issue-selection.md`));
  assert.match(selection, /具体的な変更依頼.*Issue.*選定しない/);
  assert.match(selection, /対象 Issue の選定を明示的に依頼/);
});

await test('DEV-U04: 再開時は未反映の修正を検証・反映して既存 PR を引き継ぐ', async () => {
  const skillPath = '.agents/skills/issue-development-workflow/references';
  const resume = await read(join(repository, skillPath, 'resume.md'));
  const publish = await read(join(repository, skillPath, 'publish-pr.md'));
  const ciGate = await read(join(repository, skillPath, 'ci-gate.md'));
  assert.match(
    resume,
    /ローカル HEAD.*リモートブランチの先端 SHA.*一致.*clean.*必須 CI 完了ゲート.*レビュー待ちとして終了/,
  );
  assert.match(
    resume,
    /Open PR が作成済みで未反映の変更や未 Push のコミット.*既存 PR.*implementation-review\.md.*publish-pr\.md/,
  );
  assert.ok(publish.includes('Issue・base・head が一致する候補が一件だけ'));
  assert.ok(publish.includes('既存 PR を引き継ぎ、必要な本文を更新する。新規 PR は作成しない'));
  assert.ok(publish.includes('不一致、複数候補、確認失敗'));
  assert.ok(publish.includes('先端 SHA が反映対象のローカル HEAD と一致'));
  assert.ok(publish.includes('必須 CI 完了ゲート'));
  assert.match(ciGate, /Quality gate.*成功/);
  assert.match(ciGate, /最大3回/);
  assert.match(ciGate, /全 Actions run と各 run の全 job/);
  assert.match(ciGate, /PR URL、確認 SHA、直近 CI 状態、理由と必要な対応/);
  assertContract(publish, {
    id: 'DEV-U04',
    ordered: [
      'リモート branch を再取得',
      'git status --short --untracked-files=all',
      'Issue の Open PR を再取得',
      '引き継ぐ PR がなく Open PR もない場合だけ',
      'Issue を参照する Open PR を作成',
    ],
    contains: [
      '未コミット変更がある場合は',
      'git add -- <レビュー済みのパス>',
      '未 Push の既存コミットは再作成せず',
      '未コミット変更がなければステージ・コミットを行わない',
      'PR を作成・更新しない',
    ],
  });
});

await test('DEV-U05: 既存 PR の対応と Open 状態を再開・反映前後に確認する', async () => {
  const skillPath = '.agents/skills/issue-development-workflow/references';
  const resume = await read(join(repository, skillPath, 'resume.md'));
  const publish = await read(join(repository, skillPath, 'publish-pr.md'));
  assertContract(resume, {
    id: 'DEV-U05',
    ordered: [
      '既存の Open PR を引き継ぐ前に',
      '対象 Issue・base・head',
      '一件だけ',
      '不一致、複数の候補、確認失敗',
      '変更を保全して停止',
      '現在の差分に対する検証・レビュー',
    ],
  });
  assertContract(publish, {
    id: 'DEV-U05',
    ordered: [
      '既存 PR を引き継ぐ場合は、Push 前に',
      'Issue に関連付けられた Open PR を再取得',
      'Open 状態',
      '対象 Issue・base・head が今回の作業に一致する候補が一件だけ',
      'Close・merge 済み',
      '変更を保全して停止',
      'git push --no-follow-tags --no-signed <remote> HEAD:refs/heads/<Issue 用ブランチ>',
      'リモート branch を再取得',
      '引き継いだ PR と Issue の Open PR を再取得',
      '既存 PR が Close・merge 済み',
      '停止',
      '既存 PR を引き継ぎ',
      '必要な本文を更新する',
      '引き継ぐ PR がなく Open PR もない場合だけ',
      'Issue を参照する Open PR を作成',
    ],
  });
});
