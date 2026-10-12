# Git 操作

Git 経路では、次の共通部分に表の引数を続けて実行する。設定はコマンド単位で指定し、pager・置換 ref の影響、fsmonitor・stat 比較の省略による変更の見落とし、フックによる変更、操作に付随する自動 maintenance / GC を防ぐ。

`git --no-pager --no-replace-objects -c core.fsmonitor=false -c core.trustctime=true -c core.checkStat=default -c core.hooksPath=/dev/null -c maintenance.auto=false -c gc.auto=0`

実行期限: 各 Git 操作には実行側で 60,000 ms のタイムアウトを設け、期限超過時は子・孫プロセスを含むプロセスツリーを停止して終了を確認する。終了コード・標準出力・標準エラーと期限超過の有無を取得する。この実行手段を用意できない場合は Git を実行せず停止する。期限超過は結果不明として報告し、ローカルの HEAD・index・作業状態とリモート ref の現在状態を再取得してから再試行の可否を判断する。停止・状態の再取得を確認できない場合は再試行しない。

表は引数の構成を示す。すべてのプレースホルダーは値として引数配列に渡し、シェルを介さず実行する。シェルを使う場合は、ブランチ名を含む refspec・lease 引数、コミットメッセージ、パスのすべてを、そのシェルで値が展開されないよう引用・エスケープする。二重引用符だけでは `$` 等の展開を防げない。値を文字列置換したシェルコードとして実行しない。

| 操作                       | 引数                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| index の確認               | `ls-files -v -z`                                                                                                                                                                                                    |
| index の内容               | `ls-files --stage -z`                                                                                                                                                                                               |
| 追跡ファイルの blob        | `hash-object --path="<追跡ファイルパス>" -- "<追跡ファイルパス>"`                                                                                                                                                   |
| リンク内容の blob          | `hash-object --stdin`                                                                                                                                                                                               |
| 作業状態のパス             | `rev-parse --path-format=absolute --git-path <状態名>`                                                                                                                                                              |
| clean の確認               | `status --porcelain=v1 --untracked-files=all --ignore-submodules=none`                                                                                                                                              |
| ステージ                   | `--literal-pathspecs add -- <レビュー済みパス>...`                                                                                                                                                                  |
| ステージ全体の差分         | `diff --cached --no-relative --no-ext-diff --no-textconv --ignore-submodules=none`                                                                                                                                  |
| index の tree              | `write-tree`                                                                                                                                                                                                        |
| HEAD の tree               | `rev-parse "HEAD^{tree}"`                                                                                                                                                                                           |
| コミット                   | `commit --no-gpg-sign -m "<生成したコミットメッセージ>"`                                                                                                                                                            |
| 取得先の確認               | `remote get-url --all origin`                                                                                                                                                                                       |
| Push 先の確認              | `remote get-url --push --all origin`                                                                                                                                                                                |
| 起点の取得                 | `fetch --no-tags --no-recurse-submodules --no-prune --no-prune-tags origin <取得したコミット SHA>`                                                                                                                  |
| worktree 作成              | `worktree add --detach -- <未使用の絶対パス> <取得したコミット SHA>`                                                                                                                                                |
| ブランチ作成               | `switch --no-overwrite-ignore --no-guess --no-recurse-submodules -c <Issue 用ブランチ> <取得したコミット SHA>`                                                                                                      |
| 再開の祖先確認             | `merge-base --is-ancestor <確認したリモート先端 SHA> <レビュー済みコミット SHA>`                                                                                                                                    |
| 新規 Push                  | `push --porcelain --no-signed --no-follow-tags --recurse-submodules=no --force-with-lease=refs/heads/<Issue 用ブランチ>: origin <レビュー済みコミット SHA>:refs/heads/<Issue 用ブランチ>`                           |
| 再開 Push                  | `push --porcelain --no-signed --no-follow-tags --recurse-submodules=no --force-with-lease=refs/heads/<Issue 用ブランチ>:<確認したリモート先端 SHA> origin <レビュー済みコミット SHA>:refs/heads/<Issue 用ブランチ>` |
| レビュー済みコミットの確認 | `rev-parse --verify "HEAD^{commit}"`                                                                                                                                                                                |
| コミットの tree            | `rev-parse "<レビュー済みコミット SHA>^{tree}"`                                                                                                                                                                     |
| コミットの object          | `cat-file commit <レビュー済みコミット SHA>`                                                                                                                                                                        |

作業状態の確認では、`MERGE_HEAD`、`CHERRY_PICK_HEAD`、`REVERT_HEAD`、`rebase-apply`、`rebase-merge`、`sequencer`、`BISECT_START` のそれぞれについて作業状態のパスを取得し、そのファイル・ディレクトリの不存在を確認する。いずれかが存在する場合や確認に失敗した場合は進行中の操作として停止し、自動で `continue`・`abort` や状態ファイルの削除を行わない。linked worktree でも `.git` をディレクトリと仮定しない。

clean の確認では、対象作業ツリーと初期化済み submodule のそれぞれで先に index の確認と作業状態の確認を行う。NUL 区切りの各項目の先頭が小文字（assume-unchanged）または `S`（skip-worktree）の場合は変更を隠せるため停止し、フラグを自動解除しない。その後、clean の確認が成功し、出力が空であることを確認する。submodule 内の変更も対象に含める。

clean の確認はリポジトリのルートで行い、status が空でも index の内容の各追跡パスを照合する。NUL 区切りの項目を `mode blob stage` と最初のタブ以降のパスに分け、stage が 0 以外、内容不一致、ファイルの欠落・種類の不一致、読み取り・操作失敗の場合は停止する。通常ファイル（`100644` / `100755`）は追跡ファイルの blob を取得し、改行・clean filter を適用した SHA が index の blob と一致することを確認する。シンボリックリンク（`120000`）はリンク先文字列のバイト列を、改行を加えずリンク内容の blob の標準入力へ渡す。`core.symlinks=false` の通常ファイルによるリンク表現では、そのファイルのバイト列を渡す。submodule（`160000`）は初期化済みならその HEAD の SHA を index と照合し、内部でも同じ確認を行う。未初期化の submodule は変更検査の対象外とし、初期化しない。未知の mode は停止する。照合のために index の再作成・フラグ解除・ステージを行わない。

ステージ前とコミット直前に、対象作業ツリーと初期化済み submodule の作業状態の確認を行う。ステージには、作業ツリーを基準にしたレビュー済みの個々のファイルパス（削除を含む）または submodule のパスを渡す。各パスはシェルに応じて引用し、Git のパターンとして展開させない。ステージ後はパスで絞らずステージ全体の差分をレビュー済み差分と照合し、想定外の変更があれば[変更の保全](resume.md#変更の保全)に従って停止する。コミット前に HEAD の完全な SHA と index の tree を取得する。コミット後にレビュー済みコミットの確認で完全な SHA を取得し、そのコミットの tree が index の tree と一致することと、コミットの object のヘッダー（最初の空行まで）の `parent` が 1 件だけでコミット前の HEAD SHA と一致することを確認する。不一致や確認失敗は Push せず停止する。clean を確認してから Push に進む。祖先確認と Push は同じレビュー済みコミット SHA を使い、確認後の HEAD の移動で公開内容を変えない。

取得前に取得先の確認、各 Push 前に Push 先の確認を行う。URL 書き換え後の出力が 1 件で、GitHub 側で確認した対象リポジトリの clone URL（HTTPS / SSH）とホスト・owner・リポジトリ名が一致することを確認する。複数 URL、不一致、確認失敗の場合は通信せず停止する。リモート名 `origin` だけを接続先の根拠にしない。

新規 Push の承認・不存在検査・結果判定と再開 Push の条件は[GitHub 反映](publish-pr.md)に従う。再開の祖先確認は終了コード 0 の場合だけ進み、期待値には確認した既存 ref の空でない完全な SHA を指定する。起点の取得とブランチ作成では submodule を再帰操作せず、Push は指定した Issue 用 ref だけを更新する。認証・TLS・Git 実行ファイル・filter 等の外部プログラムは、管理された実行環境で準備する。
