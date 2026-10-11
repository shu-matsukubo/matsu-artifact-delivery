# 開発の基本方針

- `README.md` は利用者向け、`AGENTS.md` は開発の入口、`docs/` は必要時に参照する開発者向け詳細資料とする。
- 文書・実装ともに簡潔に保ち、責務を広げず、説明や機能を重複させない。
- 文書・スキル・エージェント向けの説明は日本語で記述する。ファイル名、規格上のキー、固定識別子、コマンド、API 名は原表記を使い、その説明文は日本語にする。
- 通常の文書は現行の仕様・利用方法・方針を記述し、試行履歴、課題対応の経緯、旧仕様との比較を残さない。過去の制約を前提に「不要」と説明せず、必要な機能・構成・手順を直接記述する。`CHANGELOG` など履歴の記録を目的とする文書は除く。
- プラグインの構造・実装は[プラグイン仕様](https://agent-plugins.org/)と[スキル仕様](https://agentskills.io/)に従う。
- 人間・AIが保守する実装、テスト、補助スクリプトは TypeScript（`.ts`）を基本とする。ソース、スキル、エージェント、MCP は責務を分ける。
- 正本と生成物を分離し、生成物を手編集しない。
- Codex の Git 操作は、読み取りを含め開発用 [safe-git](.agents/skills/safe-git/SKILL.md) の検証付きスクリプトを使う。Git の直接実行、強制更新、ブランチ・タグの削除、既存の変更を失わせる操作は禁止する。実行ファイルの別表記、alias、オプション、shell や別スクリプトで [Codex Rules](.codex/rules/safe-git.rules) を迂回しない。人間の通常の Git 操作と、一時リポジトリ内の試験 fixture は対象外とする。

## 必要に応じて読む資料

- Codex 向け資料の配置と責務: [Codex 開発ルールの設計](docs/codex-workflows.md)
- 変更・レビュー方針: [製造・レビュー観点](docs/manufacturing-review.md)
- 試験を選ぶ判断基準: [テスト・検証観点](docs/testing-review.md)
- 試験コマンド、CI 対象、契約 ID: [試験と差分 CI](docs/testing.md)
- 配布、更新、リリース: [配布と更新](docs/distribution.md)

共通基盤の変更では、ルートの `npm run check`、`npm run lint`、`npm run format:check`、`npm test` を実行する。MCP に関わる変更では `plugins/artifact-workflow` の `check`、`lint`、`format:check` も実行する。
