# GitHub 反映と PR 作成

GitHub の操作手段と結果確認は [AGENTS.md](../../../../AGENTS.md#git-と-github-の操作)に従う。書き込み結果が不明なら状態を再取得し、確認できなければ停止する。コミットでは `--no-gpg-sign`、Push では `--no-signed` を指定する。

## 既存 PR の確認

- 既存 PR を引き継ぐ場合は、Push 前にその PR と Issue に関連付けられた Open PR を再取得する。
- Open 状態、対象 Issue・base・head が今回の作業に一致する候補が一件だけか確認する。
- 不一致、複数候補、Close・merge 済み、確認失敗時は変更を保全して停止する。

## コミット

- 未コミット変更がある場合は `git add -- <レビュー済みのパス>` で検証・レビュー済みの変更だけをステージする。
- `git diff --cached` でレビュー対象外の差分がないことを確認し、`git commit --no-gpg-sign -m '<コミットメッセージ>'` でコミットする。
- 未 Push の既存コミットは再作成せず引き継ぐ。未コミット変更がなければステージ・コミットを行わない。
- コミット後と再開時に `git diff <起点 SHA> HEAD` が検証・レビュー済みの差分と一致することを確認する。不一致なら Push せず[実装とレビュー](implementation-review.md)へ戻す。

## リモートブランチ作成

- 新規 branch は起点 SHA から選択した GitHub 手段で作成する。同名なら停止し、既存 branch に切り替えない。
- `gh` の場合: `gh api --method POST repos/<owner>/<repo>/git/refs -f 'ref=refs/heads/<Issue 用ブランチ>' -f 'sha=<起点 SHA>'`。
- 失敗や結果不明時は状態を再取得し、作成成功を確認できなければ停止する。
- 再開時は[再開判定](resume.md)で一意に特定した既存 branch を引き継ぐ。この工程で作成したリモート branch だけを再利用する。リモート未作成なら同じ作成手順を使う。

## Push

- Push URL を確認し、現在の branch と Push 先が当該 Issue branch であることを確かめる。
- 確認できたときだけ実行する: `git push --no-follow-tags --no-signed <remote> HEAD:refs/heads/<Issue 用ブランチ>`。
- [AGENTS.md](../../../../AGENTS.md#git-と-github-の操作)の禁止事項に従う。branch を確認できない場合は停止して報告する。

## 反映確認

- リモート branch を再取得し、先端 SHA が反映対象のローカル HEAD と一致することを確認する。
- `git status --short --untracked-files=all` で staged、unstaged、untracked file がなく clean と確認する。
- 不一致、失敗、レビュー対象外の変更は[変更の保全](resume.md#変更の保全)に従って停止し、PR を作成・更新しない。反映結果を確認できない場合も同様とする。

## PR 作成・更新

- 引き継いだ PR と Issue の Open PR を再取得する。不一致、複数候補、確認失敗、既存 PR が Close・merge 済みなら停止する。
- Issue・base・head が一致する候補が一件だけなら既存 PR を引き継ぎ、必要な本文を更新する。新規 PR は作成しない。
- 引き継ぐ PR がなく Open PR もない場合だけ、Issue を参照する Open PR を作成する。base は開始時の default branch、head は Issue branch とする。

PR 本文に `Closes`、`Fixes`、`Resolves` 等の Issue closing keyword を含めない。PR の merge と Issue の Close は別のライフサイクルとし、Issue はこの Skill では閉じず、人間が必要な確認を終えた後に閉じる。
