---
name: artifact-workflow
description: ユーザーが artifact-workflow またはこの Plugin の利用を明示的に指定した場合にのみ使う。計画・承認・検証・引き渡しを調停し、成果物生成、独立レビュー、依頼全体の後続処理を管理する。
compatibility: Windows x64、同梱の artifact-task-memory MCP、Codex のマルチエージェント機能が必要。
---

# 成果物ワークフローの調停

## 概要

親が計画・承認・MCP計画管理・完了条件検証・完成品の提示/引き渡しを担当し、後続処理は本 Workflow 終了後に続ける。明示指定された場合に限り適用する。

## 制約

- 承認、計画管理、検証、引き渡しは親が担当する。
- worker は標準 subagent を最低1人、同時最大3人使う。reviewer は生成/修正担当と別の標準 subagent にする。
- 計画、承認範囲、安全条件、後続処理との境界を維持する。[承認](references/approval.md)、[計画ライフサイクル](references/task-memory.md)、[相談](references/escalation.md)を参照する。
- 計画を提示する前に、親は `list_extensions` と適用候補の `get_extension` を完了する。提示計画には、適用方針のID・名前・選定理由・固定本文・`revision`、または該当なし/取得失敗の段階と理由を記載する。確認が未実施のまま計画を提示しない。詳細は[タスク計画](../task-planning/references/task-planning.md)に従う。

## フロー

1. **範囲・タスク分解・計画提示**：[task-planning Skill](../task-planning/SKILL.md)を使う。
2. **承認・計画保存**：親が[承認方針](references/approval.md)と[計画ライフサイクル](references/task-memory.md)に従う。
3. **成果物の生成・修正**：[artifact-generation Skill](../artifact-generation/SKILL.md)を使う。
4. **独立レビュー・指摘・再レビュー**：[artifact-review Skill](../artifact-review/SKILL.md)を使う。
5. **タスク・全体完了条件の検証**：[完了条件の検証方針](references/verification.md)に従う。
6. **成果物の提示・引き渡し・完了記録**：[引き渡し手順](references/delivery.md)と[計画ライフサイクル](references/task-memory.md)に従う。
