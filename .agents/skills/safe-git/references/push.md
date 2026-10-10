# Push の制約

開発用の Node.js 22.19.0 以降と Git を使う。利用者向け Plugin の実行要件や配布物には追加しない。人間が通常のターミナルで行う Git 操作は対象外とする。

Node.js は Windows の `C:/Program Files/nodejs/node.exe`、Linux の `/usr/bin/node`、macOS の `/usr/local/bin/node` に固定し、管理者が実行ファイルと配置先を保護する。信頼する起動済みのシェルで `NODE_OPTIONS`、`NODE_PATH`、`GLIBC_TUNABLES` と `LD_*`、`DYLD_*`、`_RLD_*`、`RLD_*`、`LDR_*` を組み込み機能で除去してから起動する。シェル自体の起動環境は管理者が保護する。Git・SSH・helper の子プロセスにも同じ除去を適用する。固定配置がない場合は実行を止める。起動コマンドは [Skill](../SKILL.md) を参照する。

Git 実行ファイルは Windows の `C:/Program Files/Git/cmd/git.exe`、Linux / macOS の `/usr/bin/git` に固定する。SSH 接続時は SSH 実行ファイルも Windows の `C:/Program Files/Git/usr/bin/ssh.exe`、Linux / macOS の `/usr/bin/ssh` に固定する。実体がこのパスにある通常ファイルかを検証し、PATH や環境変数で配置先を選ばない。Windows の配置先は管理者権限で保護する。Linux / macOS では実行ファイルと親ディレクトリが root 所有で、group / other が書き込めないことも検証する。固定配置に実行ファイルがない場合は検証失敗とする。

## 検証と更新

[スクリプト](../scripts/push.ts)は次を確認する。

- スクリプトの配置先が Git リポジトリのルートに対応し、そのルートから実行されている。
- 現在のブランチが `--branch` と一致し、HEAD が commit を指し、staged / unstaged / untracked の変更がない。追跡ファイルに適用される `filter.<driver>.clean` / `process` は、NUL 区切りのパスと属性値を空白・改行も含めそのまま読み、作業ツリー検査より先に拒否する。使われていない filter の設定は許可する。`skip-worktree` が付いた索引エントリーは sparse-checkout を含め拒否する。すべての Git 呼び出しで `core.fsmonitor` を無効化し、`update-index --really-refresh` で `assume-unchanged` のファイルも検査してから `status` を確認する。追跡ファイルは改行変換などの Git 属性を適用した内容のハッシュ、symlink はリンク先文字列の blob ハッシュを索引と照合し、stat 設定や時刻復元による隠れた変更も拒否する。初期化済み submodule は入れ子を含め、親の作業ツリー検査より先に同じ filter・索引・内容検査を行い、HEAD と gitlink を照合する。未初期化の submodule は内容検査を省略する。`status --ignore-submodules=none` も併用し、ignore 設定により変更を隠さない。リポジトリの設定値は変更しない。
- `origin` の取得先と Push 先が、それぞれ `shu-matsukubo/matsu-artifact-delivery` の単一 GitHub URL である。HTTPS または Git SSH の固定形式を許可し、URL 書き換え設定、複数 URL、別リポジトリは拒否する。TLS 検証の無効化・独自 CA の指定と SSH コマンドの差し替えに関わる環境変数・Git 設定も拒否する。HTTPS は既定の信頼ストアを使い、Windows は `schannel`、`schannelUseSSLCAInfo=false`、`schannelCheckRevoke=true` を指定する。`http.schannelCheckRevoke` を無効にする設定は URL 別設定を含め拒否する。Windows の `http.sslCAInfo` は `C:/Program Files/Git/etc/gitconfig` の system 設定が指定する `C:/Program Files/Git/ucrt64/etc/ssl/certs/ca-bundle.crt` または `C:/Program Files/Git/mingw64/etc/ssl/certs/ca-bundle.crt` に限定して許可し、設定ファイルと CA の実体が固定パスにあることを検証する。
- Push 先が作業ブランチであり、リモートから取得した default branch ではなく、`main`、`master`、`develop`、`development`、`release`、`releases`、`prod`、`production`、`stable` とその配下ではない。
- Git が参照する `info/grafts` が存在しない。worktree では共通 Git ディレクトリの配置先を確認する。
- `extensions.partialClone` または `remote.<name>.promisor` があるリポジトリは、submodule とブランチ作成を含め拒否する。すべての Git 呼び出しに `GIT_NO_LAZY_FETCH=1` を指定し、未検証 remote から不足 object を自動取得しない。
- 既存のリモートブランチを更新する場合、置換 ref を無効にした判定で、その先端が送信する commit の祖先である。リモートの commit がローカルにない場合は、人間が対象を確認して取得してから検証し直す。
- 検証時のリモート先端を `--force-with-lease` の期待値に指定する。新規作成時は空値を指定し、検証後にブランチが作成・更新された場合は Push を拒否する。

Push は検証した URL と `<commit SHA>:refs/heads/<作業ブランチ>` 一件だけを指定する。祖先関係の確認と先端の一致を条件とし、強制的な履歴の書き換え、削除、mirror、タグ送信、submodule の Push を行わない。pre-push hook は実行しない。GitHub 側の追加の保護ルールはサーバー側で適用される。

`--dry-run` はリモートの読み取りを含む検証を行い、更新せず送信予定を JSON で返す。通常実行は成功時に送信結果を JSON で返す。引数は `--branch` と任意の `--dry-run` に限定する。

認証は対話入力を要求せず、固定配置の credential helper・SSH agent 等を使う。HTTPS の `credential.helper` と URL 別の helper は、空値または次の名前だけを許可し、Git・SSH と同じ実体検証を行った絶対パスへ置き換える。任意の shell snippet、実行パス、追加引数、未知の helper は通信前に拒否する。複数 helper と空値によるリセットの順序を維持する。SSH の Push では helper を使用しない。

| OS      | 設定名            | 固定配置                                                                                                                                                                                  |
| ------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | `manager`         | `C:/Program Files/Git/ucrt64/bin/git-credential-manager.exe` または `C:/Program Files/Git/mingw64/bin/git-credential-manager.exe`                                                         |
| Linux   | `cache` / `store` | `/usr/lib/git-core/git-credential-cache` / `/usr/lib/git-core/git-credential-store`                                                                                                       |
| macOS   | `osxkeychain`     | `/Library/Developer/CommandLineTools/usr/libexec/git-core/git-credential-osxkeychain` または `/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core/git-credential-osxkeychain` |

Git の terminal prompt・askpass と credential helper の対話設定を無効化する。SSH は固定実行ファイルに `-F none` と `BatchMode=yes` を指定し、ユーザー・システムの SSH 設定を読み込まない。接続先は `github.com:22`、proxy は無効、ホスト鍵検証は `StrictHostKeyChecking=yes` に固定する。事前に信頼した GitHub のホスト鍵と、既定の鍵または SSH agent による認証を必要とする。Windows では SSH・helper のコマンドを解釈する `C:/Program Files/Git/usr/bin/sh.exe` も検証し、そのディレクトリを PATH の先頭に置く。各 Git コマンドは60秒でタイムアウトとし、Linux / macOS は独立したプロセスグループ、Windows は固定配置の `C:/Windows/System32/taskkill.exe /T /F` で子孫を含め停止して失敗を返す。呼び出し元の `SIGINT` / `SIGTERM` と通常終了でも同じ停止処理を行い、中断時は終了コード 130 / 143 を返す。`SIGKILL` や OS の強制終了では JavaScript の終了処理は実行できない。

## 失敗時

検証・通信・Push の失敗は終了コード 1 とする。作業を破棄せず、接続先、ブランチ、リモートの先端、ローカル差分を確認する。通信失敗では反映結果が不明な場合があるため、リモートを再取得する。競合は強制 Push で解消しない。履歴の統合が必要な場合は人間に判断を返す。

## Codex Rules

[ワークスペースの Rules](../../../../.codex/rules/safe-git.rules)が直接の Push、worktree 作成・削除、`git rm`、`git mv`、`git branch`、`git switch`、`git tag`、`git checkout-index`、`git read-tree`、`git submodule`、`git merge`、`git am`、`git cherry-pick`、`git revert`、`git fetch`、`git pull`、`git fast-import` を含む破壊的な Git コマンドを `forbidden` にする。上書き・削除オプションの位置・短縮表記にかかわらず拒否するため、これらはコマンド全体を禁止する。merge・am・cherry-pick・revert は中断による競合解消の破棄、fetch・pull は refspec・設定によるブランチやタグの強制更新・削除、fast-import はブランチ ref の強制更新、worktree add は明示・暗黙のブランチ作成と強制更新を防ぐ。worktree の準備は専用ツールの detached 作成を使い、一覧は `git worktree list` で確認する。submodule の作業状態は対象ディレクトリを cwd にした `git status` などの読み取りで確認する。ブランチ・タグの一覧は `git for-each-ref refs/heads/` / `refs/tags/`、ブランチの新規作成は [Skill](../SKILL.md) の `create-branch.ts` を使う。新規作成は現在の HEAD に限定し、既存 ref と作業変更・無視ファイルを保全し、checkout hook を実行しない。Git のグローバルオプションでサブコマンドを隠す呼び出しも禁止対象とし、作業ディレクトリはツールの cwd で指定する。

プロジェクトの `.codex/` を信頼し、Codex を再起動して読み込む。[公式 Rules 仕様](https://developers.openai.com/codex/rules)に従い、Rules は sandbox 外のコマンド要求に対するリテラルの prefix 判定である。Git 2.56 のオプション解析にある、後続コマンドへ進む独立したグローバルオプションを検査する。別の実行ファイルパス、`--git-dir=<任意値>` 等の値付き単一トークン、複雑な shell やスクリプト内部の子プロセスを網羅する強制境界ではない。Codex は [AGENTS.md](../../../../AGENTS.md) の禁止も守り、Rules を迂回しない。スクリプト実行は通常の sandbox・承認設定に従う。

```sh
codex execpolicy check --rules .codex/rules/safe-git.rules -- git push origin codex/example
```
