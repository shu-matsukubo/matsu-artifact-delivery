# Codex 開発ルールの配置と責務

リポジトリ用スキルは `.agents/skills/`、配布するスキルは各プラグインの `skills/` に置く。

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

## Workflow の使い分け

- [Issue 開発 Workflow](../.agents/skills/issue-development-workflow/SKILL.md)
- [プラグイン保守](../.agents/skills/plugin-maintenance/SKILL.md)
- [プラグインレビュー](../.agents/skills/plugin-review/SKILL.md)
- [定期 Issue 処理](../.agents/skills/scheduled-issue-processing/SKILL.md)

配置と責務は上表、実行手順は各 Skill、Git・GitHub 安全条件は [AGENTS.md](../AGENTS.md#git-と-github-の操作)に従う。モデル設定は `.codex/config.toml` と `.codex/agents/` に置く。

呼び出し例: `$issue-development-workflow <変更内容>`、`$issue-development-workflow Issue #53 を対応して PR を作成する`、`$issue-development-workflow 対応する Issue を選んで進める`、`$scheduled-issue-processing を実行する`。

構成は[Codex のスキル配置・構成](https://developers.openai.com/codex/skills)、[スキル仕様](https://agentskills.io/specification)、[プラグインのスキル作成ガイド](https://developers.openai.com/plugins/build/skills)に従う。スキルは `SKILL.md` と任意の `references/`、`assets/`、`scripts/` から構成できる。
