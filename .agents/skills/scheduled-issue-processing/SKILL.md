---
name: scheduled-issue-processing
description: スケジューラがこの Skill を明示指定した場合のみ、GitHub の「AI処理可能」Issue を処理する。通常の Issue 対応や一般的な開発作業には使用しない。
---

# 定期 Issue 処理

スケジューラが明示指定する定期実行で、プラグイン Issue を同一スレッドで処理する。GitHub Plugin を前提とし、処理順と停止判断を調整する。実装とレビューの詳細は既存 Skill に委ねる。

## 処理順

各段階で対応する reference を読み、確認できた次の段階へ進む。

1. [起動条件](references/startup.md)を確認する。
2. [前回の未完了作業を判定](references/resume.md)し、対象があれば再開する。
3. [新規処理する Issue](references/issue-selection.md)を選ぶ。
4. [最新 default branch から作業環境](references/workspace-setup.md)を準備する。
5. [実装とレビュー](references/implementation-review.md)を行う。
6. [GitHub に反映して PR を作成](references/publish-pr.md)する。
