# 新規作業の環境準備

## 起点と名前

- 選択した手段で default branch とその最新コミット SHA を確認する。
- Codex のユーザー設定から branch prefix を取得し、`<prefix>/issue/<Issue 番号>` を決める。取得できない場合は `codex` を使い、prefix の末尾にある `/` を除く。

## 作成前の確認

- `git branch --show-current`、`git remote -v`、`git status --short --untracked-files=all` で現在状態を確認し、既存変更を保全する。
- 同名のローカル・リモート branch があれば再利用・上書きせず停止して報告する。

## 隔離 worktree

- `git fetch <remote> <default branch>` で取得した SHA を起点に、元の checkout の外にある未使用パスへ作る。
- 実行: `git worktree add -b <Issue 用ブランチ> '<未使用の絶対パス>' <取得した SHA>`。
- 前回の branch やローカル HEAD、未マージまたは破棄済みの作業を引き継がない。用意できない場合は停止し、環境準備が必要だと報告する。

## 作成後の確認

- 作業ツリー内で `git branch --show-current`、`git remote -v`、`git status --short --untracked-files=all` を確認する。
- branch と接続先が意図した対象であり、`git rev-parse HEAD` が起点 SHA と一致し、clean なら実装を始める。
- 不一致・差分・確認失敗時は[変更の保全](resume.md#変更の保全)に従って停止する。

既存ブランチの再利用は、[再開判定](resume.md)で正当に特定された再開作業に限る。
