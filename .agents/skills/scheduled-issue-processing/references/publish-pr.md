# GitHub 反映と PR 作成

[起動条件](startup.md)の優先順で、操作ごとに利用可能な手段を選ぶ。

1. `git add <レビュー済みのパス>` で検証・レビュー済みの変更だけをステージし、`git commit` でローカルコミットを作成する。
2. 現在のブランチが新規作業時の命名規則で作成した当該 Issue 用ブランチであり、Push 先も同じブランチだと確認できたときだけ、`git push <remote> HEAD:refs/heads/<prefix>/issue/<Issue 番号>` のように対象を明示して反映する。保護ブランチへの直接反映、強制 Push、削除は行わない。ブランチを確認できない場合は停止して報告する。
3. 選択した手段でリモートブランチを再取得し、リモートブランチの先端 SHA が作成したコミット SHA と一致することと、`git status --short` で staged、unstaged、untracked file がなく clean であることを確認する。不一致や失敗、レビュー対象外の変更がある場合は[変更の保全](resume.md#変更の保全)に従って停止し、PR を作成しない。反映結果を確認できない場合は PR を作成しない。
4. 確認後、選択した手段で Issue を参照する Open PR を作成する。PR の base は開始時に確認した default branch、head は Issue 用ブランチとする。

PR 本文に `Closes`、`Fixes`、`Resolves` 等の Issue closing keyword を含めない。PR の merge と Issue の Close は別のライフサイクルとして扱い、Issue はこの Skill では閉じず、人間が必要な確認を終えた後に閉じる。
