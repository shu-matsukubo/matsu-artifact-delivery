---
name: plugin-maintenance
description: Issue 開発 Workflow から明示的に呼び出され、プラグインの新規作成・修正を実装・検証する。マニフェスト、スキル、MCP、配布処理、関連文書が対象。
---

# プラグインの作成・修正

## 概要

Issue 開発 Workflow から明示的に呼び出され、プラグインを実装・検証する。

## 制約

- 合意済み要件に不要な承認段階を追加しない。
- 実装・責務・正本: [実装方針](references/implementation.md)
- 試験の選択・回帰確認: [テスト設計の観点](references/test-design.md)
- 判断が必要な提案: [変更提案テンプレート](assets/change-proposal.md)

## フロー

1. 要件・既存契約を[実装方針](references/implementation.md)で確認する。
2. [テスト設計](references/test-design.md)に沿って必要な試験を実装前に実行し、維持する挙動を確認する。
3. 既存の責務と正本・生成物の境界を守って実装する。
4. 意図した仕様変更の期待値だけを更新し、必要な試験を再実行する。
5. 関係する文書・配布物を確認し、変更内容と検証結果を報告する。
