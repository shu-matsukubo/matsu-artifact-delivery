# GitHub 反映と PR 作成

[起動条件](startup.md)の優先順で、操作ごとに利用可能な手段を選ぶ。

1. 検証・レビュー済みの差分から、GitHub Plugin が提供するコミット・Git object 等の適切な機能でコミットを作成する。Git 経路を使う場合は `git add -- <レビュー済みパス>...` でレビュー済みの変更だけをステージし、`git -c core.hooksPath=/dev/null commit --no-gpg-sign -m "<生成したコミットメッセージ>"` でローカルコミットを作成する。コミット時はコマンド単位で全フックと署名を無効にし、レビュー済み差分への混入と署名の対話待ちを防ぐ。操作と承認方針は [AGENTS.md](../../../../AGENTS.md#git-と-github-の操作)に従う。
2. 新規公開では、リモート ref が存在しない場合だけ作成する操作で Issue 用ブランチへ反映する。Plugin / API 経路では ref 作成を使い、既存 ref があれば失敗することを確認する。Git 経路では `git push --no-follow-tags --force-with-lease=refs/heads/<Issue 用ブランチ>: origin HEAD:refs/heads/<Issue 用ブランチ>` を使う。末尾の `:` に続く空の期待値で ref の不存在を検査し、競合した場合は再利用・上書きせず停止する。[再開判定](resume.md)で正当に特定された再開作業の既存ブランチへの反映は、通常の fast-forward 更新を使う。Git 経路では `git push --no-follow-tags origin HEAD:refs/heads/<Issue 用ブランチ>` とする。両方の Push でタグの追従を無効にし、指定した Issue 用ブランチだけを公開する。反映結果が不明な場合はリモートを再取得してから判断する。
3. 選択した手段でリモートブランチを再取得し、リモートブランチの先端 SHA が作成したコミット SHA と一致し、その差分がレビュー済みの差分と一致することを確認する。GitHub 上のレビュー済み変更を確認できない場合は PR を作成しない。
4. ローカル HEAD の tree を反映済みリモートコミットの tree と比較し、一致していなければ、`git add -- <レビュー済みパス>...` でレビュー済みの変更だけをステージし、`git -c core.hooksPath=/dev/null commit --no-gpg-sign -m "<生成したコミットメッセージ>"` で対応するローカルコミットを作成する。コミット前に `git write-tree` が返す index の tree がリモートコミットの tree と一致することを確認する。作成後または既に一致している場合は、`git rev-parse 'HEAD^{tree}'` でローカル HEAD の tree がリモートコミットの tree と一致することと、`git status --porcelain=v1 --untracked-files=all` で staged、unstaged、untracked file がなく clean であることを確認する。不一致や失敗、レビュー対象外の変更がある場合は[変更の保全](resume.md#変更の保全)に従って停止し、PR を作成しない。
5. 確認後、選択した手段で Issue を参照する Open PR を作成する。PR の base は開始時に確認した default branch、head は Issue 用ブランチとする。

PR 本文に `Closes`、`Fixes`、`Resolves` 等の Issue closing keyword を含めない。PR の merge と Issue の Close は別のライフサイクルとして扱い、Issue はこの Skill では閉じず、人間が必要な確認を終えた後に閉じる。
