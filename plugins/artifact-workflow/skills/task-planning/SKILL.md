---
name: task-planning
description: artifact-workflow 内で生成範囲を定め、作業タスクへ分解し、計画を作成・提示する。
compatibility: artifact-workflow Skill と併用する。
---

# タスク計画

## 概要

今回の生成範囲・成果物・作業タスク・完了条件を定め、承認可能な計画を提示して親へ返す。承認・保存は artifact-workflow が担当する。

## 制約

- タスクIDは成果物の作成・変更にだけ付ける。独立レビュー、検証、引き渡し、後続処理をタスクにしない。
- 後続処理の結果が必要な成果物は、入力取得後に別計画で扱う。完了条件は実物から判定できる内容にする。

## フロー

1. **生成範囲の決定・タスク分解**：[タスク分解方針](references/task-planning.md)に従って成果物を分解する。
2. **計画の作成・提示**：[task-plan-template.md](assets/task-plan-template.md)を使い、記入案内を除いてユーザーへ提示する。
3. **artifact-workflow へ返却**：計画を親へ返す。親が[承認方針](../artifact-workflow/references/approval.md)と[計画ライフサイクル](../artifact-workflow/references/task-memory.md)に従って承認・保存する。
