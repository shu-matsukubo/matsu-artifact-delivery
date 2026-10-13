---
name: issue-development-workflow
description: このリポジトリの指定 Issue から実装・レビュー・PR 作成まで進める。Issue 未指定時は処理可能なプラグイン Issue を選ぶ。手動の Issue 対応と定期実行で共用する。
---

# Issue 開発 Workflow

Issue から PR 作成までを統括する。実装は `plugin-maintenance`、レビューは `plugin-review` に委ねる。

Git・GitHub の操作手段と安全確認は [AGENTS.md](../../../AGENTS.md#git-と-github-の操作)に従う。独自の状態ファイルやチェックポイントファイルは作成・永続化しない。状態管理用のラベルは追加しない。実行結果や中断内容は同一スレッドで報告する。

## 処理順

必要な段階の reference を読み、現在状態を確認して進む。

1. [未完了作業と作業ツリー](references/resume.md)を確認し、対象を一意に特定できる未完了作業があれば再開する。
2. 新規開始の場合は[対象 Issue](references/issue-selection.md)を確認・選定する。
3. 新規開始の場合は[最新 default branch から作業環境](references/workspace-setup.md)を準備する。
4. [実装とレビュー](references/implementation-review.md)を行い、指摘を修正する。
5. [GitHub に反映して PR を作成](references/publish-pr.md)する。
