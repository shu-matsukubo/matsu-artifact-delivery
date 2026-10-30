# Codex 開発ルールの配置と責務

Codex 向け資料は役割に応じて段階的に参照する。`AGENTS.md` から開発原則へ、作業に該当する Skill から手順へ、必要な Reference と `docs/` から詳しい判断基準・契約へ進む。

リポジトリ用スキルは `.agents/skills/`、配布するスキルは各プラグインの `skills/` に置く。

| 場所 | 役割 |
| --- | --- |
| `AGENTS.md` | 開発時の入口と、重要な共通方針への案内 |
| `.codex/config.toml` | このリポジトリで使う Codex のモデルとエージェント設定 |
| `.codex/agents/*.toml` | 専用サブエージェントの責務、モデル、推論レベル |
| `.agents/skills/<name>/SKILL.md` | 作業を選ぶ条件、スキルの前提と手順 |
| `.agents/skills/<name>/references/` | 手順ごとの詳しい判断基準や補足資料 |
| `.agents/skills/<name>/assets/` | 提案書など、繰り返し使うテンプレートや素材 |
| `.agents/skills/<name>/scripts/` | 必要性と責務が明確な小規模な状態確認・静的チェック・検証 |
| `docs/` | 現行の設計、契約、開発・配布の詳細資料 |
| `plugins/*/skills/` | 利用者へ配布するプラグインのワークフロー |

## 手順の選択

作業に合う Skill は [AGENTS.md](../AGENTS.md) から探す。各 Skill が適用条件、手順、必要な Reference を案内する。artifact-workflow のタスク計画レビュー設計と実装確認事項は[タスク計画レビュー](task-plan-review.md)を参照する。Git・GitHub の共通安全条件は [Git と GitHub の操作](git-workflow.md)、設計・実装観点は [製造・レビュー観点](manufacturing-review.md)、検証選択は [テスト・検証観点](testing-review.md)、コマンドと契約一覧は [試験と差分 CI](testing.md) を参照する。モデル設定は `.codex/config.toml` と `.codex/agents/` に置く。

構成は[Codex のスキル配置・構成](https://developers.openai.com/codex/skills)、[スキル仕様](https://agentskills.io/specification)、[プラグインのスキル作成ガイド](https://developers.openai.com/plugins/build/skills)に従う。スキルは `SKILL.md` と任意の `references/`、`assets/`、`scripts/` から構成できる。

## 日本語文書の推敲

明示的に依頼された場合は、[yomiyasu](https://github.com/nanaism/yomiyasu) を使って日本語文書を推敲する。既存の構造と意味を保ち、候補は差分で採否を判断する。

Codex のユーザー共通領域にインストールするには、次を実行する。

```sh
npx skills add nanaism/yomiyasu -a codex -g
```
