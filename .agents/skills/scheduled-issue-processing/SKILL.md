---
name: scheduled-issue-processing
description: 定期実行で GitHub の「AI処理可能」ラベル付き Issue を一件選び、実装・レビュー・PR 作成を進める。
---

# 定期 Issue 処理

このスキルは処理順と停止条件を調整する。実装規則は `plugin-maintenance`、レビュー規則は `plugin-review` に従う。

## 手順

1. 前回の作業記録、現在のタスクと作業ツリー、未完了の Issue 作業を確認する。制限到達やエラーで作業が残っていれば、可能な範囲でその作業を先に再開する。
2. GitHub Plugin でリポジトリの Open PR を確認する。ブランチ名が `/scheduled/issue/<Issue 番号>` で終わる Open PR があれば、レビュー待ちとして終了する。
3. GitHub Plugin でリポジトリ情報を最新化し、`AI処理可能` ラベルが付いた Open Issue を取得する。内容、優先度、依存関係、実装可能性を判断し、今処理する価値が高い Issue を一件選ぶ。固定の priority ラベルは要求しない。
4. Codex の実行環境、ユーザー設定、または起動時に与えられた情報から AI 作業ブランチ prefix を確認する。取得できる場合はその値を優先し、取得できない場合は `codex` を使う。末尾の `/` を取り除き、`<prefix>/scheduled/issue/<Issue 番号>` 形式でブランチを作成する。たとえば prefix が `codex`、Issue 番号が `48` の場合は `codex/scheduled/issue/48` とする。
5. `.codex/agents/issue-implementer.toml` のサブエージェントに実装を委譲する。サブエージェントは `plugin-maintenance` Skill に従って実装と検証を行う。
6. 親エージェントは `plugin-review` Skill に従って変更をレビューする。指摘があれば実装担当へ修正を戻し、問題がなくなるまでレビューを繰り返す。
7. 問題がなくなったら GitHub Plugin で Issue を参照する Open PR を作成し、作成結果を記録して終了する。

## 停止条件

- 対象となる Open PR がある場合、新しい Issue を選ばず終了する。
- 対象 Issue がない場合は終了する。
- GitHub Plugin を利用できない、または GitHub 上の状態を確認できない場合は、Issue の選定や PR 作成を行わず、確認できた状態と停止理由を報告する。
- 状態管理用のラベルは追加しない。Open PR の有無をレビュー待ち状態として扱う。
