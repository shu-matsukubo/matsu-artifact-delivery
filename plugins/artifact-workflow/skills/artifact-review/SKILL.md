---
name: artifact-review
description: artifact-workflow 内で生成担当から独立した reviewer が成果物を確認し、指摘と再レビューを行う。
compatibility: artifact-workflow Skill と Codex のマルチエージェント機能が必要。
---

# 成果物レビュー

## 概要

成果物と対象版を生成担当とは別の reviewer subagent が確認する。親は計画に固定した共通方針と共通レビュー原則を適用し、指摘の採否と修正を管理し、必要な範囲を再レビューさせる。

## 制約

- Reviewer は読み取り専用の手順を守り、編集・書き込みコマンド・外部更新・再委任を行わない。これは実行環境の権限を変更しない。
- 共通レビュー原則を適用し、各タスクで生成と同一revisionに固定された共通方針を遵守確認に使う。
- 指摘の修正は元のタスクIDで worker に戻す。変更後の実物を必要な範囲で再レビューし、親が完了条件を検証する。

## フロー

1. **独立レビュー・指摘・再レビュー**：[独立レビュー方針](references/independent-review.md)に従い、[reviewer 役割テンプレート](assets/reviewer.md)を使う。
2. **共通観点の適用**：[レビュー原則](references/review-principles.md)を適用する。
3. **親への返却**：[独立レビュー方針](references/independent-review.md)に従う。
