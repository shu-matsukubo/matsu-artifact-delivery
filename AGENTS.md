# 開発の基本方針

- `README.md` は利用者向け、`AGENTS.md` は開発の入口、`docs/` は必要時に参照する開発者向け詳細資料とする。
- 文書・実装ともに簡潔に保ち、責務を広げず、説明や機能を重複させない。
- 通常の文書は現行の仕様・利用方法・方針を記述し、試行履歴、Issue 対応の経緯、旧仕様との比較を残さない。過去の制約を前提に「不要」と説明せず、必要な機能・構成・手順を直接記述する。CHANGELOG など履歴の記録を目的とする文書は除く。
- Plugin の構造・実装は [Agent Plugins](https://agent-plugins.org/) と [Agent Skills](https://agentskills.io/) の共通規格を基準にする。
- 人間・AIが保守する実装、テスト、補助スクリプトは TypeScript（`.ts`）を基本とする。ソース、Skills、Agent、MCP は責務を分ける。
- 正本と生成物を分離し、生成物を手編集しない。

## 必要に応じて読む資料

- Codex 向け資料の配置と責務: [Codex 開発ルールの設計](docs/codex-workflows.md)
- 変更・レビュー方針: [製造・レビュー観点](docs/manufacturing-review.md)
- 試験を選ぶ判断基準: [テスト・検証観点](docs/testing-review.md)
- 試験コマンド、CI 対象、契約 ID: [試験と差分 CI](docs/testing.md)
- 配布、更新、リリース: [配布と更新](docs/distribution.md)

共通基盤の変更では、ルートの `npm run check`、`npm run lint`、`npm run format:check`、`npm test` を実行する。MCP に関わる変更では `plugins/artifact-workflow` の `check`、`lint`、`format:check` も実行する。
