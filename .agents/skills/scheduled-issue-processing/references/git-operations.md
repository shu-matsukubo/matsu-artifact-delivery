# Git 操作

Git 経路では、次の共通部分に表の引数を続けて実行する。設定はコマンド単位で指定し、fsmonitor による変更の見落とし、フックによる変更、操作に付随する自動 maintenance / GC を防ぐ。

`git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c maintenance.auto=false -c gc.auto=0`

| 操作               | 引数                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| index の確認       | `ls-files -v -z`                                                                                                                                                    |
| clean の確認       | `status --porcelain=v1 --untracked-files=all --ignore-submodules=none`                                                                                              |
| ステージ           | `--literal-pathspecs add -- <レビュー済みパス>...`                                                                                                                  |
| ステージ全体の差分 | `diff --cached --no-ext-diff --no-textconv --ignore-submodules=none`                                                                                                |
| index の tree      | `write-tree`                                                                                                                                                        |
| HEAD の tree       | `rev-parse "HEAD^{tree}"`                                                                                                                                           |
| コミット           | `commit --no-gpg-sign -m "<生成したコミットメッセージ>"`                                                                                                            |
| 起点の取得         | `fetch --no-tags --no-recurse-submodules --no-prune --no-prune-tags origin <取得したコミット SHA>`                                                                  |
| worktree 作成      | `worktree add --detach -- <未使用の絶対パス> <取得したコミット SHA>`                                                                                                |
| ブランチ作成       | `switch --no-overwrite-ignore --no-guess --no-recurse-submodules -c <Issue 用ブランチ> <取得したコミット SHA>`                                                      |
| 新規 Push          | `push --porcelain --no-signed --no-follow-tags --recurse-submodules=no --force-with-lease=refs/heads/<Issue 用ブランチ>: origin HEAD:refs/heads/<Issue 用ブランチ>` |
| 再開 Push          | `push --no-signed --no-follow-tags --recurse-submodules=no origin HEAD:refs/heads/<Issue 用ブランチ>`                                                               |

clean の確認では、対象作業ツリーと初期化済み submodule のそれぞれで先に index の確認を行う。NUL 区切りの各項目の先頭が小文字（assume-unchanged）または `S`（skip-worktree）の場合は変更を隠せるため停止し、フラグを自動解除しない。その後、clean の確認が成功し、出力が空であることを確認する。submodule 内の変更も対象に含める。

ステージには、作業ツリーを基準にしたレビュー済みの個々のファイルパス（削除を含む）または submodule のパスを渡す。各パスはシェルに応じて引用し、Git のパターンとして展開させない。ステージ後はパスで絞らずステージ全体の差分をレビュー済み差分と照合し、想定外の変更があれば[変更の保全](resume.md#変更の保全)に従って停止する。コミット前に index の tree を取得し、コミット後に HEAD の tree が一致することと clean を確認してから Push に進む。

新規 Push の承認・不存在検査・結果判定と再開 Push の条件は[GitHub 反映](publish-pr.md)に従う。起点の取得とブランチ作成では submodule を再帰操作せず、Push は指定した Issue 用 ref だけを更新する。認証・TLS・Git 実行ファイル・filter 等の外部プログラムは、管理された実行環境で準備する。
