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

await test('SCH-U01: 明示起動、現在状態による再開判定と担当境界を維持する', async () => {
  const { metadata, body } = frontmatter(
    await read(join(repository, '.agents/skills/scheduled-issue-processing/SKILL.md')),
  );
  assert.equal(metadata.name, 'scheduled-issue-processing');
  assert.match(metadata.description, /スケジューラが.*明示指定した場合のみ/);
  assert.match(metadata.description, /通常の Issue 対応や一般的な開発作業には使用しない/);
  assert.match(body, /GitHub Plugin.*read\/write capability/s);
  assert.match(body, /git、`gh`、ブラウザー等へフォールバックせず停止/);

  const steps = body.split(/(?=^\d+\. |^## )/m).filter((section) => /^\d+\. /.test(section));
  const startup = [
    /GitHub Plugin の利用可否/,
    /未完了作業の有無/,
    /リポジトリの Open PR/,
    /git status --porcelain=v1 --untracked-files=all/,
    /`AI処理可能` ラベル付きの Open Issue/,
    /default branch とその最新コミット SHA/,
  ].map((contract) => {
    const index = steps.findIndex((step) => contract.test(step));
    assert.ok(index >= 0, `Missing startup contract: ${contract}`);
    return index;
  });
  assert.ok(startup.every((index, position) => position === 0 || index > startup[position - 1]!));
  const resume = steps[startup[1]!]!;
  assert.match(body, /スケジューラ \/ オートメーションから同一スレッドで繰り返し実行/);
  assert.match(body, /同一スレッドの過去の会話・実行ログ.*前回実行時の結果や中断内容.*Memory.*補助情報/);
  assert.match(body, /状態の正本ではなく/);
  assert.match(body, /過去ログや Memory 等が利用できないこと自体をエラーや停止理由にしない/);
  assert.match(body, /GitHub とローカル workspace の現在状態を最終的な判断材料/);
  assert.match(body, /独自の状態ファイルやチェックポイントファイル.*作成・永続化しない/);
  assert.doesNotMatch(body, /作業ディレクトリ外の永続的な作業記録|記録を保存できない場合は停止/);
  assert.doesNotMatch(body, /開始前と各段階の前後.*記録|完了記録|記録の base branch|記録したコミット SHA/);
  assert.match(
    resume,
    /利用可能な補助情報.*GitHub Plugin.*Issue・PR・branch・commit.*ローカル HEAD・branch・worktree.*照合/,
  );
  assert.match(resume, /制限到達、エラー、その他の中断/);
  assert.match(
    resume,
    /過去ログ等と現在状態から.*Open Issue.*branch.*workspace.*差分.*安全に一意に特定.*新しい Issue を選ばず.*再開/,
  );
  assert.match(resume, /確認できた既存ブランチのみ再利用/);
  assert.match(resume, /その作業によるローカル変更を利用/);
  assert.match(resume, /現在の差分に対する検証・レビュー完了を確認できなければ/);
  assert.match(resume, /前回作業を一意に特定できない場合.*staged \/ unstaged \/ untracked.*確認/);
  assert.match(resume, /clean なら未完了作業なしとして手順 3 へ進む/);
  assert.match(resume, /変更がある場合は由来を推測せず、人間による確認が必要と報告して停止/);
  const clean = steps[startup[3]!]!;
  assert.match(clean, /staged、unstaged、untracked file/);
  assert.match(clean, /差分があれば.*人間による確認が必要.*終了/);
  assert.match(clean, /新規開始に適用.*正当に特定した再開作業には適用しない/);
  assert.match(body, /`reset`.*`checkout`.*`restore`.*`stash`.*`clean`.*未追跡ファイルの削除.*行わない/);
  assert.match(body, /異常状態は自動修復しない/);
  assert.match(resume, /PR 作成済み.*base・head.*差分が検証・レビュー済みの作業と一致.*レビュー待ちとして終了/);
  assert.match(body, /default branch とその最新コミット SHA/);
  assert.match(body, /取得したコミット SHA と一致する新しい隔離作業ツリー/);
  assert.match(body, /前回の作業ブランチ、ローカル HEAD、未マージまたは破棄済み作業の変更は引き継がない/);
  assert.match(body, /取得した SHA から作成する/);
  assert.match(body, /同名ブランチが既にある場合は再利用・上書きせず停止/);
  assert.match(body, /`git push` は使用しない/);
  assert.match(body, /リモートブランチの先端 SHA が作成したコミット SHA と一致/);
  assert.match(body, /その差分がレビュー済みの差分と一致することを確認してから、Issue を参照する Open PR を作成/);
  assert.match(body, /`Closes`、`Fixes`、`Resolves` 等の Issue closing keyword を含めない/);
  assert.match(body, /Issue はこの Skill では閉じず/);
  assert.match(body, /状態管理用のラベルは追加しない/);
  assert.match(body, /plugin-maintenance/);
  assert.match(body, /plugin-review/);

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

await test('SCH-U02: scheduled selection excludes in-progress and merged implementations and non-plugin Issues', async () => {
  const { body } = frontmatter(await read(join(repository, '.agents/skills/scheduled-issue-processing/SKILL.md')));
  const selection = body.split('\n').find((line) => /^\d+\. GitHub Plugin で `AI処理可能`/.test(line));
  assert.ok(selection, 'Missing Issue selection step');
  assert.match(selection, /プラグインの新規作成・修正に該当する候補だけを対象/);
  assert.match(selection, /インフラ、CI、リポジトリ文書のみの Issue は対象外/);
  assert.match(selection, /関連付けられた実装 PR を、ブランチ名にかかわらず確認/);
  assert.match(selection, /Open の実装 PR がある候補.*merge 済みの実装 PR があり人間の Close 待ちの候補は除外/);

  const implementer = parseToml(await read(join(repository, '.codex/agents/issue-implementer.toml'))) as {
    developer_instructions: string;
  };
  assert.match(implementer.developer_instructions, /プラグインの新規作成・修正に該当しない場合は実装を開始せず/);
  assert.match(implementer.developer_instructions, /対象外であることを親エージェントに返す/);
});
