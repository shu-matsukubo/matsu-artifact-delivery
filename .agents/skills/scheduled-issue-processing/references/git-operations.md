# Git 操作

Git 経路では、次の共通部分に表の引数を続けて実行する。設定はコマンド単位で指定し、pager・置換 ref の影響、fsmonitor による変更の見落とし、フックによる変更、操作に付随する自動 maintenance / GC を防ぐ。

`git --no-pager --no-replace-objects -c core.fsmonitor=false -c core.hooksPath=/dev/null -c maintenance.auto=false -c gc.auto=0`

表は引数の構成を示す。すべてのプレースホルダーは値として引数配列に渡し、シェルを介さず実行する。シェルを使う場合は、ブランチ名を含む refspec・lease 引数、コミットメッセージ、パスのすべてを、そのシェルで値が展開されないよう引用・エスケープする。二重引用符だけでは `$` 等の展開を防げない。値を文字列置換したシェルコードとして実行しない。

| 操作               | 引数                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| index の確認       | `ls-files -v -z`                                                                                                                                                                              |
| clean の確認       | `status --porcelain=v1 --untracked-files=all --ignore-submodules=none`                                                                                                                        |
| ステージ           | `--literal-pathspecs add -- <レビュー済みパス>...`                                                                                                                                            |
| ステージ全体の差分 | `diff --cached --no-ext-diff --no-textconv --ignore-submodules=none`                                                                                                                          |
| index の tree      | `write-tree`                                                                                                                                                                                  |
| HEAD の tree       | `rev-parse "HEAD^{tree}"`                                                                                                                                                                     |
| コミット           | `commit --no-gpg-sign -m "<生成したコミットメッセージ>"`                                                                                                                                      |
| 取得先の確認       | `remote get-url --all origin`                                                                                                                                                                 |
| Push 先の確認      | `remote get-url --push --all origin`                                                                                                                                                          |
| 起点の取得         | `fetch --no-tags --no-recurse-submodules --no-prune --no-prune-tags origin <取得したコミット SHA>`                                                                                            |
| worktree 作成      | `worktree add --detach -- <未使用の絶対パス> <取得したコミット SHA>`                                                                                                                          |
| ブランチ作成       | `switch --no-overwrite-ignore --no-guess --no-recurse-submodules -c <Issue 用ブランチ> <取得したコミット SHA>`                                                                                |
| 再開の祖先確認     | `merge-base --is-ancestor <確認したリモート先端 SHA> HEAD`                                                                                                                                    |
| 新規 Push          | `push --porcelain --no-signed --no-follow-tags --recurse-submodules=no --force-with-lease=refs/heads/<Issue 用ブランチ>: origin HEAD:refs/heads/<Issue 用ブランチ>`                           |
| 再開 Push          | `push --porcelain --no-signed --no-follow-tags --recurse-submodules=no --force-with-lease=refs/heads/<Issue 用ブランチ>:<確認したリモート先端 SHA> origin HEAD:refs/heads/<Issue 用ブランチ>` |

clean の確認では、対象作業ツリーと初期化済み submodule のそれぞれで先に index の確認を行う。NUL 区切りの各項目の先頭が小文字（assume-unchanged）または `S`（skip-worktree）の場合は変更を隠せるため停止し、フラグを自動解除しない。その後、clean の確認が成功し、出力が空であることを確認する。submodule 内の変更も対象に含める。

ステージには、作業ツリーを基準にしたレビュー済みの個々のファイルパス（削除を含む）または submodule のパスを渡す。各パスはシェルに応じて引用し、Git のパターンとして展開させない。ステージ後はパスで絞らずステージ全体の差分をレビュー済み差分と照合し、想定外の変更があれば[変更の保全](resume.md#変更の保全)に従って停止する。コミット前に index の tree を取得し、コミット後に HEAD の tree が一致することと clean を確認してから Push に進む。

取得前に取得先の確認、各 Push 前に Push 先の確認を行う。URL 書き換え後の出力が 1 件で、GitHub 側で確認した対象リポジトリの clone URL（HTTPS / SSH）とホスト・owner・リポジトリ名が一致することを確認する。複数 URL、不一致、確認失敗の場合は通信せず停止する。リモート名 `origin` だけを接続先の根拠にしない。

新規 Push の承認・不存在検査・結果判定と再開 Push の条件は[GitHub 反映](publish-pr.md)に従う。再開の祖先確認は終了コード 0 の場合だけ進み、期待値には確認した既存 ref の空でない完全な SHA を指定する。起点の取得とブランチ作成では submodule を再帰操作せず、Push は指定した Issue 用 ref だけを更新する。認証・TLS・Git 実行ファイル・filter 等の外部プログラムは、管理された実行環境で準備する。
