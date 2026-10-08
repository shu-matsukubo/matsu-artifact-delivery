import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { parse as parseToml } from 'smol-toml';
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
    'README.md',
    'docs/testing.md',
    'docs/distribution.md',
    'docs/codex-workflows.md',
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

await test('SCH-U01: 入口から判断フローを参照でき、起動・再開・反映契約と担当境界を維持する', async () => {
  const skillPath = '.agents/skills/scheduled-issue-processing';
  const { metadata, body } = frontmatter(await read(join(repository, skillPath, 'SKILL.md')));
  assert.equal(metadata.name, 'scheduled-issue-processing');
  assert.match(metadata.description, /スケジューラが.*明示指定した場合のみ/);
  assert.match(metadata.description, /通常の Issue 対応や一般的な開発作業には使用しない/);

  const references = [
    'startup.md',
    'resume.md',
    'issue-selection.md',
    'workspace-setup.md',
    'implementation-review.md',
    'publish-pr.md',
  ].map((name) => `${skillPath}/references/${name}`);
  assert.deepEqual(await localLinks(repository, `${skillPath}/SKILL.md`), references);
  assert.equal(body.split('\n').filter((line) => /^\d+\. /.test(line)).length, 6);
  for (const reference of references) await localLinks(repository, reference);
  const [startup, resume, selection, workspace, implementation, publish] = await Promise.all([
    read(join(repository, references[0]!)),
    read(join(repository, references[1]!)),
    read(join(repository, references[2]!)),
    read(join(repository, references[3]!)),
    read(join(repository, references[4]!)),
    read(join(repository, references[5]!)),
  ]);
  const all = [body, startup, resume, selection, workspace, implementation, publish].join('\n');
  assert.doesNotMatch(all, /作業ディレクトリ外の永続的な作業記録|記録を保存できない場合は停止/);
  assert.doesNotMatch(all, /開始前と各段階の前後.*記録|完了記録|記録の base branch|記録したコミット SHA/);

  assert.match(startup, /スケジューラから Skill 名を直接指定して起動/);
  assert.match(startup, /通常の Issue 対応や一般的な開発作業では使用しない/);
  assert.match(startup, /スケジューラ \/ オートメーションから同一スレッドで繰り返し実行/);
  assert.match(startup, /人間が普段操作するリポジトリとは別の、スケジューラ専用 clone \/ 作業ディレクトリ/);
  assertContract(startup, {
    id: 'SCH-U01',
    ordered: ['GitHub Plugin', '`gh`', 'その他利用可能な手段'],
    contains: ['操作ごと', '公開情報', 'URL', '認証', '再取得', 'safe-git'],
  });
  assert.doesNotMatch(all, /フォールバックせず停止|GitHub Plugin を前提/);
  assert.match(startup, /独自の状態ファイルやチェックポイントファイル.*作成・永続化しない/);
  assert.match(startup, /状態管理用のラベルは追加しない/);
  assert.match(startup, /実行結果や中断内容は同一スレッドで報告/);

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
  assert.match(resume, /clean なら未完了作業なしとして.*新規 Issue の選定/);
  assert.match(resume, /変更がある場合は由来を推測せず、人間による確認が必要と報告して停止/);
  assert.match(resume, /base branch・起点 SHA と既存の作業ツリーを引き継ぐ/);
  assert.match(resume, /全段階で異常状態は自動修復しない/);
  assert.match(resume, /`reset`.*`checkout`.*`restore`.*`stash`.*`clean`.*未追跡ファイルの削除.*行わない/);
  assert.match(resume, /PR 作成済み.*base・head.*差分が検証・レビュー済みの作業と一致.*レビュー待ちとして終了/);

  assertContract(selection, {
    id: 'SCH-U01',
    ordered: [
      'リポジトリの Open PR',
      'git status --porcelain=v1 --untracked-files=all',
      '`AI処理可能` ラベル付きの Open Issue',
    ],
  });
  assert.match(selection, /\/scheduled\/issue\/<Issue 番号>.*Open PR.*新しい Issue を選ばず.*レビュー待ち/);
  assert.match(selection, /staged、unstaged、untracked file.*clean/);
  assert.match(selection, /確認に失敗した場合は停止/);
  assert.match(selection, /差分があれば.*人間による確認が必要.*終了/);
  assert.match(selection, /新規開始に適用.*正当に特定した再開作業には適用しない/);
  assert.match(selection, /対象 Issue がない場合は終了/);

  assert.match(workspace, /選択した手段.*default branch とその最新コミット SHA/);
  assert.match(workspace, /ユーザー設定にあるブランチ prefix/);
  assert.match(workspace, /prefix が設定から取得できない場合は `codex`/);
  assert.match(workspace, /取得したコミット SHA と一致する新しい隔離作業ツリー/);
  assert.match(workspace, /前回の作業ブランチ、ローカル HEAD、未マージまたは破棄済み作業の変更は引き継がない/);
  assert.match(workspace, /作業ツリーを用意できない場合は停止/);
  assert.match(workspace, /選択した手段.*取得した SHA から作成する/);
  assert.match(workspace, /同名ブランチが既にある場合は再利用・上書きせず停止/);
  assert.match(workspace, /既存ブランチの再利用は.*正当に特定された再開作業に限る/);

  assert.match(implementation, /issue-implementer\.toml.*担当エージェントに実装を委譲/);
  assert.match(implementation, /plugin-maintenance.*GPT-6 Luna \/ reasoning medium/);
  assert.match(implementation, /親エージェント.*plugin-review.*GPT-6\.1 Sol \/ reasoning xhigh/);
  assert.match(implementation, /指摘があれば実装担当へ修正を戻し、問題がなくなるまでレビューを繰り返す/);

  assertContract(publish, {
    id: 'SCH-U01',
    ordered: [
      'コミットを作成',
      'リモートブランチを再取得',
      '対応するローカルコミットを作成',
      'git status --porcelain=v1 --untracked-files=all',
      '選択した手段で Issue を参照する Open PR を作成',
    ],
  });
  assert.match(publish, /検証・レビュー済みの差分.*GitHub Plugin.*コミット・Git object.*ref 更新/);
  assert.match(publish, /safe-git.*ローカルコミット.*Push/);
  assert.match(publish, /`git push` の直接実行は禁止/);
  assert.match(publish, /リモートブランチの先端 SHA が作成したコミット SHA と一致.*差分がレビュー済みの差分と一致/);
  assert.match(publish, /確認できない場合は PR を作成しない/);
  assert.match(
    publish,
    /ローカル HEAD の tree.*リモートコミットの tree.*一致していなければ.*レビュー済みの変更だけを stage/,
  );
  assert.match(publish, /コミット前に index の tree.*リモートコミットの tree と一致.*確認/);
  assert.match(
    publish,
    /ローカル HEAD の tree.*リモートコミットの tree と一致.*staged、unstaged、untracked file.*clean/,
  );
  assert.match(publish, /不一致や失敗、レビュー対象外の変更.*変更の保全.*停止し、PR を作成しない/);
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

await test('SCH-U02: 選定 reference が対象外・実装中・merge 済みの Issue を除外する', async () => {
  const selection = await read(
    join(repository, '.agents/skills/scheduled-issue-processing/references/issue-selection.md'),
  );
  assert.match(selection, /プラグインの新規作成・修正に該当する候補だけを対象/);
  assert.match(selection, /インフラ、CI、リポジトリ文書のみの Issue は対象外/);
  assert.match(selection, /関連付けられた実装 PR を、ブランチ名にかかわらず確認/);
  assert.match(selection, /Open の実装 PR がある候補.*merge 済みの実装 PR があり人間の Close 待ちの候補は除外/);
  assert.match(selection, /内容、優先度、依存関係、実装可能性を判断して一件選ぶ/);
  assert.match(selection, /固定の priority ラベルは要求しない/);

  const implementer = parseToml(await read(join(repository, '.codex/agents/issue-implementer.toml'))) as {
    developer_instructions: string;
  };
  assert.match(implementer.developer_instructions, /プラグインの新規作成・修正に該当しない場合は実装を開始せず/);
  assert.match(implementer.developer_instructions, /対象外であることを親エージェントに返す/);
});
