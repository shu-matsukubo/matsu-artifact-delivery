---
name: scheduled-issue-processing
description: スケジューラがこの Skill を明示指定した場合のみ、GitHub の「AI処理可能」Issue を処理する。通常の Issue 対応や一般的な開発作業には使用しない。
---

# 定期 Issue 処理

## 概要

スケジューラが Skill 名を明示して起動する定期 Issue 処理を扱う。

## 制約

- 通常の Issue 対応や一般的な開発作業では使用しない。
- 中断条件と判断基準: [起動条件と中断判断](references/startup.md)

## フロー

1. 起動条件と既存作業を確認する。
2. 実行可能な場合は [issue-development-workflow](../issue-development-workflow/SKILL.md) を Issue 未指定で呼び出す。
