# 前回作業の判定と再開

- 現在状態を確認する: `git branch --show-current`、`git remote -v`、`git status --short --untracked-files=all`。
- 確認失敗、競合、Git 操作中の状態では停止する。
- 同一スレッドの過去の会話・実行ログ、前回実行時の結果や中断内容、利用可能な Memory は状態の正本ではなく補助情報とする。過去ログや Memory 等が利用できないこと自体をエラーや停止理由にしない。
- GitHub とローカル workspace の現在状態を最終的な判断材料とする。
- 新規 Issue の処理前に、利用可能な補助情報と選択した手段で取得した Issue・PR・branch・commit を確認する。
- ローカル HEAD・branch・worktree・staged / unstaged / untracked と照合し、未完了作業を判定する。
- 指定 Issue だけを再開し、別の Issue は再開しない。現在の作業ツリーに別作業が残る場合は保全して停止する。

## 作業を一意に特定できる場合

制限到達、エラー、その他の中断で未完了作業がある場合:

- 過去ログ等と現在状態から Open Issue、branch、workspace、差分を安全に一意に特定する。
- 特定した作業は新しい Issue を選ばず、現在状態で確認できた未完了の段階から再開する。

- 再開対象として確認できた既存ブランチのみ再利用し、その作業によるローカル変更を利用する。
- 現在状態から確認できる base branch・起点 SHA と既存の作業ツリーを引き継ぐ。
- 既存の Open PR を引き継ぐ前に、対象 Issue・base・head が今回の作業に一致し、候補が一件だけであることを確認する。不一致、複数の候補、確認失敗があれば、変更を保全して停止する。
- 現在の差分に対する検証・レビュー完了を確認できなければ、[実装とレビュー](implementation-review.md)へ戻す。
- 対応する Open PR 作成済みで、PR の base・head およびリモートに反映された差分が検証・レビュー済みの作業と一致し、ローカル HEAD がリモートブランチの先端 SHA と一致し、staged / unstaged / untracked がなく clean の場合は、レビュー待ちとして終了する。
- Open PR 作成済みで未反映の変更や未 Push のコミットがある場合は、既存 PR を引き継ぎ、[実装とレビュー](implementation-review.md)を経て[GitHub 反映](publish-pr.md)へ進む。

## 作業を特定できない場合

- ローカル workspace の staged / unstaged / untracked とブランチを確認する。
- clean で未完了作業を示す Issue branch 等がなければ[新規 Issue の選定](issue-selection.md)へ進む。
- 変更がある場合は由来を推測せず、人間による確認が必要と報告して停止する。由来不明の Issue branch でも停止する。
- 新規開始は staged、unstaged、untracked file がなく clean であることを確認する。正当に特定した再開作業には適用しない。

## 変更の保全

- 全段階で異常状態は自動修復しない。`reset`、変更破棄のための `checkout` / `restore`、`stash`、`clean`、未追跡ファイルの削除など、既存の変更を失わせる操作は行わない。
