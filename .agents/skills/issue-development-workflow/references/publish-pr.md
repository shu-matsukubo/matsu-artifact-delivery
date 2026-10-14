# GitHub 反映と PR 作成

[Git 操作方針](../../../../AGENTS.md#git-と-github-の操作)に従い、操作ごとに利用可能な GitHub 手段を選ぶ。書き込み結果が不明な場合は現在状態を再取得し、確認できなければ停止して報告する。署名による無人実行の停止を避けるため、コミットに `--no-gpg-sign`、Push に `--no-signed` を指定する。

1. 未コミットの変更がある場合は、`git add -- <レビュー済みのパス>` で検証・レビュー済みの変更だけをステージし、`git diff --cached` でステージ済みの差分全体にレビュー対象外の変更がないことを確認して、`git commit --no-gpg-sign -m '<コミットメッセージ>'` でローカルコミットを作成する。既存の未 Push のコミットは再作成せず、反映対象として引き継ぐ。コミット後と再開時のどちらも `git diff <起点 SHA> HEAD` の差分全体が検証・レビュー済みの差分と一致することを確認し、不一致なら Push せず[実装とレビュー](implementation-review.md)へ戻す。
2. 新規のリモートブランチは起点 SHA から選択した GitHub 手段のブランチ作成機能で作成する。同名ブランチがあれば停止し、既存ブランチへ切り替えない。`gh` では `gh api --method POST repos/<owner>/<repo>/git/refs -f 'ref=refs/heads/<Issue 用ブランチ>' -f 'sha=<起点 SHA>'` を使う。失敗や結果不明時は現在状態を再取得し、作成成功を確認できなければ停止する。再開時は[再開判定](resume.md)で一意に特定した既存の当該 Issue 用ブランチを引き継ぎ、この処理で作成済みのリモートブランチだけを再利用する。リモートが未作成の再開作業にも同じブランチ作成手順を適用する。
3. [Git 操作方針](../../../../AGENTS.md#git-と-github-の操作)に従って Push 先の URL を確認し、現在のブランチが当該 Issue 用ブランチであり、Push 先も同じブランチだと確認できたときだけ、`git push --no-follow-tags --no-signed <remote> HEAD:refs/heads/<Issue 用ブランチ>` のように対象を明示して反映する。保護ブランチへの直接反映、強制 Push、削除は行わない。ブランチを確認できない場合は停止して報告する。
4. 選択した手段でリモートブランチを再取得し、リモートブランチの先端 SHA が作成したコミット SHA と一致することと、`git status --short --untracked-files=all` で staged、unstaged、untracked file がなく clean であることを確認する。不一致や失敗、レビュー対象外の変更がある場合は[変更の保全](resume.md#変更の保全)に従って停止し、PR を作成・更新しない。反映結果を確認できない場合は PR を作成・更新しない。
5. 確認後、Issue に関連付けられた Open PR を再取得する。一件だけで base・head と対象 Issue が今回の作業と一致する場合は、既存 PR を引き継ぎ、必要な本文更新を行い、新規 PR を作成しない。PR の不一致、複数の候補、確認失敗があれば停止して報告する。Open PR がない場合だけ、選択した手段で Issue を参照する Open PR を作成する。PR の base は開始時に確認した default branch、head は Issue 用ブランチとする。

PR 本文に `Closes`、`Fixes`、`Resolves` 等の Issue closing keyword を含めない。PR の merge と Issue の Close は別のライフサイクルとして扱い、Issue はこの Skill では閉じず、人間が必要な確認を終えた後に閉じる。
