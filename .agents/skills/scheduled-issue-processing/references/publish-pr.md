# GitHub 反映と PR 作成

1. 検証・レビュー済みの差分から、GitHub Plugin が提供するコミット・Git object 等の適切な機能でコミットを作成し、ref 更新等で Issue 用リモートブランチへ反映する。`git push` は使用しない。反映機能または権限が不足している場合は停止し、Plugin の導入または権限設定が必要と報告する。
2. GitHub Plugin でリモートブランチを再取得し、リモートブランチの先端 SHA が作成したコミット SHA と一致し、その差分がレビュー済みの差分と一致することを確認する。GitHub 上のレビュー済み変更を確認できない場合は PR を作成しない。
3. 確認後、GitHub Plugin で Issue を参照する Open PR を作成する。PR の base は開始時に確認した default branch、head は Issue 用ブランチとする。

PR 本文に `Closes`、`Fixes`、`Resolves` 等の Issue closing keyword を含めない。PR の merge と Issue の Close は別のライフサイクルとして扱い、Issue はこの Skill では閉じず、人間が必要な確認を終えた後に閉じる。
