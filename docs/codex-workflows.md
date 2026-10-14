# Codex 開発ルールの設計

Codex のリポジトリ用スキルは `.agents/skills/` に置く。配布するプラグインのスキルは各プラグインの `skills/` に置き、両者を混在させない。

| 場所 | 役割 |
| --- | --- |
| `AGENTS.md` | 常時適用する短い開発方針、検証コマンド、必要な資料への案内 |
| `.codex/config.toml` | このリポジトリで使う Codex のモデルとエージェント設定 |
| `.codex/agents/*.toml` | 専用サブエージェントの責務、モデル、推論レベル |
| `.agents/skills/<name>/SKILL.md` | 作業を選ぶ条件、スキルの前提と手順 |
| `.agents/skills/<name>/references/` | 手順ごとの詳しい判断基準や補足資料 |
| `.agents/skills/<name>/assets/` | 提案書など、繰り返し使うテンプレートや素材 |
| `.agents/skills/<name>/scripts/` | 必要性と責務が明確な小規模な状態確認・静的チェック・検証 |
| `docs/` | 現行の設計、契約、開発・配布の詳細資料 |
| `plugins/*/skills/` | 利用者へ配布するプラグインのワークフロー |

リポジトリ用スキルはリポジトリの作業手順を定義し、責務を分けて他のスキルと連携する。`SKILL.md` にスキルの前提と手順を記し、手順の詳細を references、再利用する文面を assets に分ける。設計資料と実行手順を重複して記述しない。

開発用 Skills は Markdown を主体とし、既存コマンドで容易に代替できる処理は手順から直接利用する。配布プラグインの実行コードと共通のビルド・配布・検証基盤は、それぞれの責務に応じて実装する。

[Issue 開発 Workflow](../.agents/skills/issue-development-workflow/SKILL.md) は手動の Issue 対応と定期実行で共用する。未完了作業の再開、対象確認・選定、作業環境の準備、実装・レビュー、PR 作成を統括する。[実装とレビューの調整](../.agents/skills/issue-development-workflow/references/implementation-review.md)で対象範囲に応じた手順を選び、プラグイン変更には `plugin-maintenance` / `plugin-review`、インフラ・CI・リポジトリ文書のみの変更には共通の開発・検証方針を適用する。モデルと推論レベルは `.codex/config.toml` と `.codex/agents/` で設定する。

手動では `$issue-development-workflow Issue #53 を対応して PR を作成する` のように指定する。Issue 指定時は依頼された対象を扱い、未指定時は `AI処理可能` ラベル付きのプラグイン Issue を選ぶ。

[定期 Issue 処理](../.agents/skills/scheduled-issue-processing/SKILL.md) はスケジューラが名前を明示して起動する。専用 clone / 作業ディレクトリで、同じ定期処理の Open PR や作業状態から中断を判断し、実行可能な場合に Issue 開発 Workflow を呼び出す。スケジューラには `$scheduled-issue-processing を実行する` と指定する。

Git・GitHub の操作手段、Issue ブランチから PR までの手順と停止条件は [AGENTS.md](../AGENTS.md#git-と-github-の操作)に従う。Workflow は単体実行でも作業ツリー・ブランチの安全性を確認する。

この構成は[Codex のスキル配置・構成](https://developers.openai.com/codex/skills)、[スキル仕様](https://agentskills.io/specification)、[プラグインのスキル作成ガイド](https://developers.openai.com/plugins/build/skills)に従う。Codex はリポジトリの `.agents/skills/` を探索し、スキルは `SKILL.md` と任意の `references/`、`assets/`、`scripts/` から構成できる。
