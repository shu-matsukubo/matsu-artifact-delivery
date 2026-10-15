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

await test('PKG-U03: Plugin documentation resolves local links and explains reviewer permissions', async () => {
  for (const path of [
    'AGENTS.md',
    'README.md',
    ...(await readdir(join(repository, 'docs'))).filter((path) => path.endsWith('.md')).map((path) => `docs/${path}`),
    'plugins/artifact-workflow/README.md',
    'plugins/expert-escalation/README.md',
  ])
    await localLinks(repository, path);

  const workflowReadme = await read(join(repository, 'plugins/artifact-workflow/README.md'));
  assert.ok(workflowReadme.includes('これは実行環境の権限を変更しません'));
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

await test('SCH-U01: 定期起動の条件と中断判断を確認して共通 Workflow へ渡す', async () => {
  const skillPath = '.agents/skills/scheduled-issue-processing';
  const { metadata, body } = frontmatter(await read(join(repository, skillPath, 'SKILL.md')));
  assert.equal(metadata.name, 'scheduled-issue-processing');
  assert.match(metadata.description, /スケジューラが.*明示指定した場合のみ/);
  assert.match(metadata.description, /通常の Issue 対応や一般的な開発作業には使用しない/);
  const references = await localLinks(repository, `${skillPath}/SKILL.md`);
  assert.ok(references.includes(`${skillPath}/references/startup.md`));
  assert.ok(references.includes('.agents/skills/issue-development-workflow/SKILL.md'));
  const startup = await read(join(repository, skillPath, 'references/startup.md'));
  const startupLinks = await localLinks(repository, `${skillPath}/references/startup.md`);
  assert.match(startup, /スケジューラから Skill 名を直接指定して起動/);
  assert.match(startup, /同一スレッドで繰り返し実行/);
  assert.match(startup, /スケジューラ専用 clone \/ 作業ディレクトリ/);
  assertContract(startup, {
    id: 'SCH-U01',
    ordered: [
      'Open PR',
      '作業状態',
      '再開判定',
      'ローカル HEAD',
      'リモートブランチの先端 SHA',
      'staged / unstaged / untracked',
      '由来不明の変更',
      'レビュー待ち条件を満たす場合だけ',
      'レビュー待ちとして終了',
      '未反映の変更や未 Push のコミット',
      'Workflow を呼び出す',
    ],
    contains: ['ブランチ名だけで', '一意に特定', '人間による確認が必要', '再開'],
  });
  assert.ok(startupLinks.includes('.agents/skills/issue-development-workflow/references/resume.md'));
  assert.match(startup, /未反映の変更や未 Push のコミット.*差分を保全.*Workflow.*再開/);
  assert.doesNotMatch(
    [body, startup].join('\n'),
    /git (?:fetch|worktree add|commit|push)|担当エージェントに実装を委譲/,
  );
  assert.deepEqual(await files(join(repository, skillPath)), ['SKILL.md', 'references/startup.md']);
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
  assert.ok(entryLinks.includes('AGENTS.md'));
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

  assert.match(resume, /新規 Issue の処理より前に/);
  assert.match(resume, /同一スレッドの過去の会話・実行ログ.*前回実行時の結果や中断内容.*Memory.*補助情報/);
  assert.match(resume, /状態の正本ではなく/);
  assert.match(resume, /過去ログや Memory 等が利用できないこと自体をエラーや停止理由にしない/);
  assert.match(resume, /GitHub とローカル workspace の現在状態を最終的な判断材料/);
  assert.match(
    resume,
    /利用可能な補助情報.*選択した手段.*Issue・PR・branch・commit.*ローカル HEAD・branch・worktree.*照合/,
  );
  assert.match(resume, /制限到達、エラー、その他の中断/);
  assert.match(
    resume,
    /過去ログ等と現在状態から.*Open Issue.*branch.*workspace.*差分.*安全に一意に特定.*新しい Issue を選ばず.*再開/,
  );
  assert.match(resume, /確認できた既存ブランチのみ再利用/);
  assert.match(resume, /その作業によるローカル変更を利用/);
  assert.match(resume, /現在の差分に対する検証・レビュー完了を確認できなければ.*\(implementation-review\.md\).*戻す/);
  assert.match(resume, /前回作業を一意に特定できない場合.*staged \/ unstaged \/ untracked.*確認/);
  assert.match(resume, /clean.*未完了作業.*なければ.*新規 Issue の選定/);
  assert.match(resume, /変更がある場合は由来を推測せず、人間による確認が必要と報告して停止/);
  assert.match(resume, /base branch・起点 SHA と既存の作業ツリーを引き継ぐ/);
  assert.match(resume, /全段階で異常状態は自動修復しない/);
  assert.match(resume, /`reset`.*`checkout`.*`restore`.*`stash`.*`clean`.*未追跡ファイルの削除.*行わない/);
  assert.match(resume, /PR 作成済み.*base・head.*差分が検証・レビュー済みの作業と一致.*レビュー待ちとして終了/);

  assert.match(selection, /対象 Issue がない場合は終了/);
  assert.match(resume, /指定 Issue.*別の Issue.*再開しない/);
  assert.match(resume, /git branch --show-current.*git remote -v.*git status --short --untracked-files=all/);
  assert.match(resume, /競合.*Git 操作中.*停止/);
  assert.match(resume, /新規開始.*正当に特定した再開作業には適用しない/);

  assert.match(workspace, /選択した手段.*default branch とその最新コミット SHA/);
  assert.match(workspace, /ユーザー設定にあるブランチ prefix/);
  assert.match(workspace, /prefix が設定から取得できない場合は `codex`/);
  assert.match(workspace, /取得したコミット SHA と一致する新しい隔離作業ツリー/);
  assert.match(workspace, /前回の作業ブランチ、ローカル HEAD、未マージまたは破棄済み作業の変更は引き継がない/);
  assert.match(workspace, /作業ツリーを用意できない場合は停止/);
  assert.match(workspace, /<prefix>\/issue\/<Issue 番号>/);
  assert.match(workspace, /git fetch.*git worktree add -b/);
  assert.match(workspace, /元の checkout の外にある未使用のパス/);
  assert.match(
    workspace,
    /作成した作業ツリー内で.*git branch --show-current.*git remote -v.*git status --short --untracked-files=all/,
  );
  assert.match(workspace, /git rev-parse HEAD.*起点 SHA.*一致.*clean.*実装/);
  assert.doesNotMatch(workspace, /<prefix>\/scheduled\/issue/);
  assert.match(workspace, /同名ブランチが既にある場合は再利用・上書きせず停止/);
  assert.match(workspace, /既存ブランチの再利用は.*正当に特定された再開作業に限る/);

  assert.match(implementation, /issue-implementer\.toml.*担当エージェントに実装を委譲/);
  assert.match(implementation, /担当エージェント.*GPT-6 Luna \/ reasoning medium/);
  assert.match(implementation, /親エージェント.*GPT-6\.1 Sol \/ reasoning xhigh/);
  assert.match(implementation, /指摘があれば実装担当へ修正を戻し、問題がなくなるまでレビューを繰り返す/);

  assertContract(publish, {
    id: 'DEV-U01',
    ordered: [
      'git diff --cached',
      'コミットを作成',
      'git diff <起点 SHA> HEAD',
      'ブランチ作成機能',
      'git push --no-follow-tags --no-signed <remote> HEAD:refs/heads/<Issue 用ブランチ>',
      'リモートブランチを再取得',
      'git status --short --untracked-files=all',
      '選択した手段で Issue を参照する Open PR を作成',
    ],
  });
  assert.match(publish, /`git add.*検証・レビュー済みの変更だけをステージ.*`git commit --no-gpg-sign -m/);
  const agents = await read(join(repository, 'AGENTS.md'));
  assert.ok(agents.includes('git push --no-follow-tags <remote> HEAD:refs/heads/<Issue 用ブランチ>'));
  assert.match(publish, /署名.*無人実行.*--no-gpg-sign.*--no-signed/);
  assert.match(publish, /AGENTS\.md#git-と-github-の操作/);
  assert.match(agents, /git remote get-url --push --all <remote>.*URL が一件だけ.*対象リポジトリ/);
  assert.match(publish, /コミット後.*差分.*検証・レビュー済み.*一致.*Push/);
  assert.match(publish, /新規.*起点 SHA.*ブランチ作成機能.*同名ブランチ.*停止/);
  assert.match(publish, /再開.*一意に特定.*既存.*当該 Issue 用ブランチ/);
  assert.match(publish, /当該 Issue 用ブランチ.*Push 先も同じブランチ.*確認できたときだけ/);
  assert.match(publish, /確認できない場合は PR を作成・更新しない/);
  assert.match(publish, /staged、unstaged、untracked file.*clean/);
  assert.match(publish, /不一致や失敗、レビュー対象外の変更.*変更の保全.*停止し、PR を作成・更新しない/);
  assert.match(publish, /PR の base は開始時に確認した default branch、head は Issue 用ブランチ/);
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
  assert.match(selection, /対象 Issue の選定を依頼.*`AI処理可能` ラベル付きの Open Issue/);
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
  assert.match(implementation, /プラグインの新規作成・修正に関わる範囲.*plugin-maintenance.*plugin-review/);
  assert.match(implementation, /インフラ、CI、リポジトリ文書のみ.*AGENTS\.md.*製造・レビュー観点.*テスト・検証観点/);
  assert.match(implementation, /混在.*対象範囲ごと.*変更全体.*レビュー/);

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

  const workflowPath = '.agents/skills/issue-development-workflow';
  const workflow = await read(join(repository, `${workflowPath}/SKILL.md`));
  assert.match(frontmatter(workflow).metadata.description, /具体的な変更依頼/);
  assert.match(workflow, /Issue が未指定の具体的な変更依頼では.*別の Issue は選ばない/);
  assert.match(workflow, /Issue が指定された依頼.*次の手順に従って Issue 開発から PR 作成まで進める/);
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
    ordered: [
      '委任メッセージを用意する',
      'リテラルの `$plugin-maintenance`',
      'そのメッセージを',
      '担当エージェントに実装を委譲する',
    ],
  });
  assert.match(implementation, /plugin-maintenance.*plugin-review/);
  assert.match(implementation, /実装.*レビュー/);
  assert.ok(implementation.indexOf('plugin-maintenance') < implementation.indexOf('plugin-review'));
  assert.ok(implementation.includes('プラグインの新規作成・修正に関わる範囲では、リテラルの `$plugin-maintenance`'));

  const implementer = parseToml(await read(join(repository, '.codex/agents/issue-implementer.toml'))) as {
    developer_instructions: string;
  };
  assert.match(implementer.developer_instructions, /プラグイン.*\$plugin-maintenance.*明示的に使う/);

  const selection = await read(join(repository, `${workflowPath}/references/issue-selection.md`));
  assert.match(selection, /具体的な変更依頼.*Issue.*選定しない/);
  assert.match(selection, /対象 Issue の選定を依頼/);
});

await test('DEV-U04: 再開時は未反映の修正を検証・反映して既存 PR を引き継ぐ', async () => {
  const skillPath = '.agents/skills/issue-development-workflow/references';
  const resume = await read(join(repository, skillPath, 'resume.md'));
  const publish = await read(join(repository, skillPath, 'publish-pr.md'));
  assert.match(resume, /ローカル HEAD.*リモートブランチの先端 SHA.*一致.*clean.*レビュー待ちとして終了/);
  assert.match(
    resume,
    /Open PR 作成済みで未反映の変更や未 Push のコミット.*既存 PR.*implementation-review\.md.*publish-pr\.md/,
  );
  assert.match(publish, /一件.*base・head.*対象 Issue.*一致.*既存 PR.*新規 PR を作成しない/);
  assert.match(publish, /PR の不一致、複数の候補、確認失敗.*停止/);
  assert.match(publish, /リモートブランチの先端 SHA が反映対象のローカル HEAD の SHA と一致/);
  assertContract(publish, {
    id: 'DEV-U04',
    ordered: [
      'リモートブランチを再取得',
      'git status --short --untracked-files=all',
      'Issue に関連付けられた Open PR を再取得',
      'Open PR がない場合だけ',
      '選択した手段で Issue を参照する Open PR を作成',
    ],
    contains: ['未コミットの変更がある場合は', '未 Push のコミットは再作成せず', 'PR を作成・更新しない'],
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
      'Open PR を再取得',
      'Open 状態',
      '対象 Issue・base・head',
      '一件だけ',
      'Close・merge 済み',
      '変更を保全して停止',
      'git push --no-follow-tags --no-signed <remote> HEAD:refs/heads/<Issue 用ブランチ>',
      'リモートブランチを再取得',
      'Issue に関連付けられた Open PR を再取得',
      '引き継いだ既存 PR が Close・merge 済み',
      '停止',
      '既存 PR を引き継ぎ',
      '必要な本文更新',
      '引き継ぐ既存 PR がなく、Open PR がない場合だけ',
      '選択した手段で Issue を参照する Open PR を作成',
    ],
  });
});
