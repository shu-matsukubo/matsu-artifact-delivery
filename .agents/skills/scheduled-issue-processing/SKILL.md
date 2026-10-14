---
name: scheduled-issue-processing
description: スケジューラがこの Skill を明示指定した場合のみ、GitHub の「AI処理可能」Issue を処理する。通常の Issue 対応や一般的な開発作業には使用しない。
---

# 定期 Issue 処理

スケジューラが明示指定する定期実行で、同一スレッドの開発作業を進めてよいか判断する。

## 処理順

1. [起動条件と中断判断](references/startup.md)を確認する。
2. 実行可能なら [issue-development-workflow](../issue-development-workflow/SKILL.md) を Issue 未指定で呼び出し、未完了作業の再開または新規 Issue の処理を任せる。
