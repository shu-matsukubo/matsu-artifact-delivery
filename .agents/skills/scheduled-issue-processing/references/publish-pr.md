# GitHub 反映と PR 作成

[起動条件](startup.md)の優先順で、操作ごとに利用可能な手段を選ぶ。

1. 検証・レビュー済みの差分から、GitHub Plugin が提供するコミット・Git object 等の適切な機能でコミットを作成し、ref 更新等で Issue 用リモートブランチへ反映する。Git 経路を使う場合は [safe-git](../../safe-git/SKILL.md) の手順でレビュー済みの変更だけを stage して `commit.ts` でローカルコミットを作成し、スクリプトで Push する。`git push` の直接実行は禁止する。`git commit` も直接実行しない。どの経路でも保護ブランチへの直接反映、強制更新、削除は行わない。反映結果が不明な場合はリモートを再取得してから判断する。
2. 選択した手段でリモートブランチを再取得し、リモートブランチの先端 SHA が作成したコミット SHA と一致し、その差分がレビュー済みの差分と一致することを確認する。GitHub 上のレビュー済み変更を確認できない場合は PR を作成しない。
3. ローカル HEAD の tree を反映済みリモートコミットの tree と比較し、一致していなければ、レビュー済みの変更だけを stage して [safe-git](../../safe-git/SKILL.md) の `commit.ts` で対応するローカルコミットを作成する。コミット前に index の tree がリモートコミットの tree と一致することを確認する。作成後または既に一致している場合は、ローカル HEAD の tree がリモートコミットの tree と一致することと、`git status --porcelain=v1 --untracked-files=all` で staged、unstaged、untracked file がなく clean であることを確認する。不一致や失敗、レビュー対象外の変更がある場合は[変更の保全](resume.md#変更の保全)に従って停止し、PR を作成しない。
4. 確認後、選択した手段で Issue を参照する Open PR を作成する。PR の base は開始時に確認した default branch、head は Issue 用ブランチとする。

PR 本文に `Closes`、`Fixes`、`Resolves` 等の Issue closing keyword を含めない。PR の merge と Issue の Close は別のライフサイクルとして扱い、Issue はこの Skill では閉じず、人間が必要な確認を終えた後に閉じる。
