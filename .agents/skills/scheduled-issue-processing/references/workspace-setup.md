# 新規作業の環境準備

1. 選択した手段でリポジトリの default branch とその最新コミット SHA を確認する。Codex のユーザー設定にあるブランチ prefix を使い、末尾の `/` を除いて `<prefix>/issue/<Issue 番号>` 形式のブランチ名を決める。prefix が設定から取得できない場合は `codex` を使う。
2. `git branch --show-current`、`git remote -v`、`git status --short` で現在状態を確認し、既存の変更を保全する。同名のローカル・リモートブランチがないことを確認する。新規処理で同名ブランチが既にある場合は再利用・上書きせず停止して状況を報告する。
3. `git fetch <remote> <default branch>` で取得したコミット SHA と一致する新しい隔離作業ツリーを、`git worktree add -b <Issue 用ブランチ> <未使用のパス> <取得した SHA>` で用意する。新規開始では前回の作業ブランチ、ローカル HEAD、未マージまたは破棄済み作業の変更は引き継がない。作業ツリーを用意できない場合は停止し、環境の準備が必要と報告する。
4. 作成した作業ツリー内で `git branch --show-current`、`git remote -v`、`git status --short` を確認する。ブランチと接続先が意図した対象であり、`git rev-parse HEAD` が起点 SHA と一致し、clean であることを確認してから実装を始める。不一致・差分・確認失敗があれば[変更の保全](resume.md#変更の保全)に従って停止する。

既存ブランチの再利用は、[再開判定](resume.md)で正当に特定された再開作業に限る。
