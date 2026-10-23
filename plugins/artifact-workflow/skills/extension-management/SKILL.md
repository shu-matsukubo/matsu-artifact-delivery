---
name: extension-management
description: 利用者の依頼に基づき、成果物生成・独立レビューで再利用する指示を登録・検索・参照・更新・削除する。
compatibility: Windows x64、同梱の artifact-task-memory MCP が必要。
---

# 拡張指示の管理

## 概要

利用者から登録管理を明示された場合に、生成・レビュー用の拡張指示を管理する。

## 制約

- 成果物の生成・レビュー依頼では起動しない。登録指示の実行条件は artifact-workflow の[実行境界](../artifact-workflow/references/execution-boundaries.md)に従う。
- 利用者の意図を保ち、要求にない手順・コマンド・品質基準を追加しない。

## フロー

1. **登録・一覧・詳細・更新・削除**：[管理方針](references/management.md)に従う。
