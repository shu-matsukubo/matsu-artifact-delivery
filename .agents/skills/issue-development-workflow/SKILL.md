---
name: issue-development-workflow
description: このリポジトリの具体的な変更依頼を実装・レビューする。Issue の対応・選定では Issue 開発から PR 作成まで進める。
---

# Issue 開発 Workflow

## 概要

具体的な変更依頼、Issue 対応、明示された Issue 選定を扱う。

## 制約

- Git・GitHub 操作と安全条件: [Git と GitHub の操作](../../../docs/git-workflow.md)
- 独自の状態ファイルやチェックポイントファイルを作成・永続化しない。状態管理用のラベルは追加しない。実行結果や中断内容は同一スレッドで報告する。
- Issue が未指定の具体的な変更依頼では別の Issue を選ばず、依頼範囲を実装・レビューする。

## フロー

開始時は[仕様の明確化](references/spec-clarification.md)を確認し、仕様上の判断待ちがあれば回答の確認まで先へ進まない。

Issue 未指定の具体的な変更依頼は[実装とレビュー](references/implementation-review.md)へ進む。

Issue が指定された依頼、Issue 選定では次の順に進む。

1. [未完了作業と作業ツリー](references/resume.md)を確認し、特定できた作業を再開する。
2. 新規開始時は[対象 Issue](references/issue-selection.md)を確認する。Issue 選定は明示依頼がある場合に限る。
3. 新規開始時は[作業環境](references/workspace-setup.md)を準備する。
4. 再開・新規を問わず[実装とレビュー](references/implementation-review.md)を行う。
5. [GitHub に反映して PR を作成](references/publish-pr.md)する。
