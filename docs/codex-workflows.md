# Codex 開発ルールの設計

Codex のリポジトリ用スキルは `.agents/skills/` に置く。配布するプラグインのスキルは各プラグインの `skills/` に置き、両者を混在させない。

| 場所 | 役割 |
| --- | --- |
| `AGENTS.md` | 常時適用する短い開発方針、検証コマンド、必要な資料への案内 |
| `.codex/config.toml` | このリポジトリで使う Codex のモデルとエージェント設定 |
| `.codex/agents/*.toml` | 専用サブエージェントの責務、モデル、推論レベル |
| `.codex/rules/*.rules` | Codex による直接の Push・破壊的な Git コマンドの禁止 |
| `.agents/skills/<name>/SKILL.md` | 作業を選ぶ条件、スキルの前提と手順 |
| `.agents/skills/<name>/references/` | 手順ごとの詳しい判断基準や補足資料 |
| `.agents/skills/<name>/assets/` | 提案書など、繰り返し使うテンプレートや素材 |
| `.agents/skills/<name>/scripts/` | スキルで使う検証付きの実行処理 |
| `docs/` | 現行の設計、契約、開発・配布の詳細資料 |
| `plugins/*/skills/` | 利用者へ配布するプラグインのワークフロー |

リポジトリ用スキルはリポジトリの作業手順を定義し、責務を分けて他のスキルと連携する。`SKILL.md` にスキルの前提と手順を記し、手順の詳細を references、再利用する文面を assets に分ける。設計資料と実行手順を重複して記述しない。

定期 Issue 処理 Skill はスケジューラが名前を明示して起動する。`.agents/skills/scheduled-issue-processing/SKILL.md` がプラグイン Issue の選定、順序と停止条件を調整し、実装とレビューはそれぞれ `plugin-maintenance` と `plugin-review` に委ねる。モデルと推論レベルは `.codex/config.toml` と `.codex/agents/` で設定する。

GitHub 操作は [定期 Issue 処理の起動条件](../.agents/skills/scheduled-issue-processing/references/startup.md)に従って利用可能な手段を選ぶ。Codex が Git でステージ・Push、作業ブランチ・コミットの新規作成を行う場合は、開発専用の [safe-git](../.agents/skills/safe-git/SKILL.md) を呼び出す。スクリプトの検証条件・失敗時の扱い・Rules の適用範囲は [検証の制約](../.agents/skills/safe-git/references/push.md)を参照する。

この構成は[Codex のスキル配置・構成](https://developers.openai.com/codex/skills)、[スキル仕様](https://agentskills.io/specification)、[プラグインのスキル作成ガイド](https://developers.openai.com/plugins/build/skills)に従う。Codex はリポジトリの `.agents/skills/` を探索し、スキルは `SKILL.md` と任意の `references/`、`assets/`、`scripts/` から構成できる。
