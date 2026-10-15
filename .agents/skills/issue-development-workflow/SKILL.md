---
name: issue-development-workflow
description: このリポジトリの具体的な変更依頼を実装・レビューする。Issue の対応・選定と定期実行では Issue 開発から PR 作成まで進める。
---

# Issue 開発 Workflow

Issue が未指定の具体的な変更依頼では依頼された範囲を[実装とレビュー](references/implementation-review.md)に従って進め、別の Issue は選ばない。Issue が指定された依頼、Issue 選定または定期実行では、次の手順に従って Issue 開発から PR 作成まで進める。

Git・GitHub の操作手段と安全確認は [AGENTS.md](../../../AGENTS.md#git-と-github-の操作)に従う。独自の状態ファイルやチェックポイントファイルは作成・永続化しない。状態管理用のラベルは追加しない。実行結果や中断内容は同一スレッドで報告する。

## 処理順

必要な段階の reference を読み、現在状態を確認して進む。

1. [未完了作業と作業ツリー](references/resume.md)を確認し、対象を一意に特定できる未完了作業があれば再開する。
2. 新規開始の場合は[対象 Issue](references/issue-selection.md)を確認する。Issue 選定は選定依頼か定期実行の場合に限る。
3. 新規開始の場合は[最新 default branch から作業環境](references/workspace-setup.md)を準備する。
4. [実装とレビュー](references/implementation-review.md)を行い、指摘を修正する。
5. [GitHub に反映して PR を作成](references/publish-pr.md)する。
