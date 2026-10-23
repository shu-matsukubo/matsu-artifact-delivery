# 実装とレビューの調整

## 実装担当への委任

- 依頼内容・完了条件（Issue がある場合はその情報）、worktree、担当範囲を委任メッセージに含める。
- プラグイン変更ではリテラルの `$plugin-maintenance` を含め、[plugin-maintenance](../../plugin-maintenance/SKILL.md) を明示的に使うよう指示する。
- [issue-implementer](../../../../.codex/agents/issue-implementer.toml) に委任する。担当は GPT-6 Luna / reasoning medium。

## 実装・レビュー

- プラグイン変更: 担当は `plugin-maintenance` に従って実装・検証し、親は [plugin-review](../../plugin-review/SKILL.md) でレビューする。`plugin-maintenance` は Workflow 専用、`plugin-review` は単独依頼にも使える。
- インフラ・CI・リポジトリ文書のみ: [AGENTS.md](../../../../AGENTS.md)、[製造・レビュー観点](../../../../docs/manufacturing-review.md)、[テスト・検証観点](../../../../docs/testing-review.md)に従う。
- 混在変更: 範囲ごとの手順を適用し、依存先を含め変更全体をレビューする。
- 親は GPT-6.1 Sol / reasoning xhigh でレビューする。指摘を実装担当へ戻し、解消までレビューを繰り返す。
