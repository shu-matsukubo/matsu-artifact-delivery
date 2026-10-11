# 新規作業の環境準備

1. 選択した手段でリポジトリの default branch とその最新コミット SHA を取得する。Codex のユーザー設定にあるブランチ prefix を使い、末尾の `/` を除いて `<prefix>/scheduled/issue/<Issue 番号>` 形式のブランチ名を決める。prefix が設定から取得できない場合は `codex` を使う。
2. 取得したコミット SHA と一致する新しい隔離作業ツリーを用意する。Git 経路では [safe-git](../../safe-git/SKILL.md) の `fetch.ts --commit <取得する commit SHA>` で指定 commit を取得してから、`create-worktree.ts --path <未使用の絶対パス> --commit <取得済み commit SHA>` で detached worktree を作る。新規開始では前回の作業ブランチ、ローカル HEAD、未マージまたは破棄済み作業の変更は引き継がない。指定 SHA を基点にした作業ツリーを用意できない場合は停止し、環境の準備が必要と報告する。
3. 選択した手段で同名のリモートブランチが存在しないことを確認し、取得した SHA から作成する。新規処理で同名ブランチが既にある場合は再利用・上書きせず停止して状況を報告する。

既存ブランチの再利用は、[再開判定](resume.md)で正当に特定された再開作業に限る。
