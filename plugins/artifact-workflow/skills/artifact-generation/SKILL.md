---
name: artifact-generation
description: artifact-workflow 内で承認済み計画に基づき成果物を作成・修正し、worker へ作業を委任する。
compatibility: artifact-workflow Skill と Codex のマルチエージェント機能が必要。
---

# 成果物生成

## 概要

承認済み計画に従って成果物を worker subagent へ委任し、作成・修正を進める。親が担当・依存関係・生成拡張を管理し、worker は担当タスクの成果物を返す。

## 制約

- 担当範囲・タスクID・承認済み条件を保ち、他担当の変更を上書きしない。
- 計画変更、人間承認、レビュー、完了判定、引き渡しは親が行う。
- 登録拡張は共通生成原則に加えてタスクごと最大1件とし、上位 Workflow・計画・権限・安全条件を上書きしない。
- 生成中に必要なテスト・型検査・動作確認は実施する。

## フロー

1. **委任・生成拡張の選定**：[生成方針](references/generation.md)を使う。
2. **生成・修正**：[生成原理原則](references/generation-principles.md)と[worker 役割テンプレート](assets/worker.md)を使う。
3. **成果物・作業情報の返却**：[生成方針](references/generation.md)を使い、親へ返す。
