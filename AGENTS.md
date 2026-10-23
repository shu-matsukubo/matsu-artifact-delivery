# 開発の基本方針

- `README.md` は利用者向け、`AGENTS.md` は開発の入口、`docs/` は必要時に参照する開発者向け詳細資料とする。
- 文書・実装ともに簡潔に保ち、責務を広げず、説明や機能を重複させない。
- 文書・スキル・エージェント向けの説明は日本語で記述する。ファイル名、規格上のキー、固定識別子、コマンド、API 名は原表記を使い、その説明文は日本語にする。
- 通常の文書は現行の仕様・利用方法・方針を記述し、試行履歴、課題対応の経緯、旧仕様との比較を残さない。過去の制約を前提に「不要」と説明せず、必要な機能・構成・手順を直接記述する。`CHANGELOG` など履歴の記録を目的とする文書は除く。
- プラグインの構造・実装は[プラグイン仕様](https://agent-plugins.org/)と[スキル仕様](https://agentskills.io/)に従う。
- 人間・AIが保守する実装、テスト、補助スクリプトは TypeScript（`.ts`）を基本とする。ソース、スキル、エージェント、MCP は責務を分ける。
- 正本と生成物を分離し、生成物を手編集しない。
- Skills は「概要・制約・フロー」を入口に記し、詳細を責務別 Reference に置く。Asset は利用役割ごとに所有させ、正本をリンクで示す。短い箇条書き・表・リンクを優先する。
- 開発用 Skills は Markdown の手順・判断基準を主体とし、補助スクリプトは既存コマンドで代替できない小規模な状態確認・静的チェック・検証に限る。配布対象の `plugins/` には適用しない。

## Git と GitHub の操作

- Git 操作は通常の Git CLI を使う。GitHub 操作は必要な機能と権限を確認し、GitHub Plugin を最優先、利用できない操作は `gh` を使う。両方が利用できない、権限が足りない、成否を確認できない場合は停止し、ユーザーへエラーと不足事項を報告する。
- 作業開始前に現在のブランチ、接続先、staged / unstaged / untracked の差分を確認し、既存の変更を保全する。競合・不明な状態は停止して報告する。
- 検証・レビュー済みのパスだけをステージ・コミットし、コミット後の差分照合、Push、PR 作成は [反映手順](.agents/skills/issue-development-workflow/references/publish-pr.md)に従う。
- Issue 作業の branch・worktree 準備と再開は [workspace-setup](.agents/skills/issue-development-workflow/references/workspace-setup.md) と [resume](.agents/skills/issue-development-workflow/references/resume.md) に従う。
- Push 前に `git remote get-url --push --all <remote>` で取得した URL が一件だけで、対象リポジトリと一致することを確認する。
- 保護ブランチへの直接コミット・Push・マージ、強制 Push、ブランチ・タグの削除、既存の変更を失わせる操作は行わない。判断できない場合は停止して報告する。

これらは操作の判断基準であり、強制的な防御機構ではない。権限の制御は実行環境の承認設定と GitHub のブランチ保護で行う。

## 必要に応じて読む資料

- Codex 向け資料の配置と責務: [Codex 開発ルールの設計](docs/codex-workflows.md)
- 変更・レビュー方針: [製造・レビュー観点](docs/manufacturing-review.md)
- 試験を選ぶ判断基準: [テスト・検証観点](docs/testing-review.md)
- 試験コマンド、CI 対象、契約 ID: [試験と差分 CI](docs/testing.md)
- 配布、更新、リリース: [配布と更新](docs/distribution.md)

共通基盤の変更では、ルートの `npm run check`、`npm run lint`、`npm run format:check`、`npm test` を実行する。MCP に関わる変更では `plugins/artifact-workflow` の `check`、`lint`、`format:check` も実行する。
