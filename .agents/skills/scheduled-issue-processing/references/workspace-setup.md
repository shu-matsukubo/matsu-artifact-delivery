# 新規作業の環境準備

1. 選択した手段でリポジトリの default branch とその最新コミット SHA を取得する。Codex のユーザー設定にあるブランチ prefix を使い、末尾の `/` を除いて `<prefix>/scheduled/issue/<Issue 番号>` 形式のブランチ名を決める。prefix が設定から取得できない場合は `codex` を使う。
2. 取得したコミット SHA と一致する新しい隔離作業ツリーを、元のリポジトリ外にある未使用の絶対パスへ用意する。Git 経路では [Git 操作](git-operations.md)の起点の取得を実行してから、worktree 作成で detached worktree を作る。新規開始では前回の作業ブランチ、ローカル HEAD、未マージまたは破棄済み作業の変更は引き継がない。指定 SHA を基点にした作業ツリーを用意できない場合は停止し、環境の準備が必要と報告する。
3. 選択した手段で同名のリモートブランチが存在しないことを確認し、取得した SHA からローカル作業ブランチを作成する。Git 経路では作成した worktree で [Git 操作](git-operations.md)のブランチ作成を実行する。リモートブランチは[GitHub 反映](publish-pr.md)の新規公開時に作成する。新規処理で同名ブランチが既にある場合は再利用・上書きせず停止して状況を報告する。

worktree 作成後とブランチ切り替え後に、新しい作業ツリーの HEAD が取得した SHA と一致し、[Git 操作](git-operations.md)の clean の確認で staged、unstaged、untracked file がなく clean であることを確認する。不一致や変更がある場合は[変更の保全](resume.md#変更の保全)に従って停止する。

既存ブランチの再利用は、[再開判定](resume.md)で正当に特定された再開作業に限る。
