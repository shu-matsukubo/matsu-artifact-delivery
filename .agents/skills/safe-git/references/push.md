# Push の制約

開発用の Node.js 22.19.0 以降と Git を使う。利用者向け Plugin の実行要件や配布物には追加しない。人間が通常のターミナルで行う Git 操作は対象外とする。

Git 実行ファイルは Windows の `C:/Program Files/Git/cmd/git.exe`、Linux / macOS の `/usr/bin/git` に固定する。SSH 接続時は SSH 実行ファイルも Windows の `C:/Program Files/Git/usr/bin/ssh.exe`、Linux / macOS の `/usr/bin/ssh` に固定する。実体がこのパスにある通常ファイルかを検証し、PATH や環境変数で配置先を選ばない。Windows の配置先は管理者権限で保護する。Linux / macOS では実行ファイルと親ディレクトリが root 所有で、group / other が書き込めないことも検証する。固定配置に実行ファイルがない場合は検証失敗とする。

## 検証と更新

[スクリプト](../scripts/push.ts)は次を確認する。

- スクリプトの配置先が Git リポジトリのルートに対応し、そのルートから実行されている。
- 現在のブランチが `--branch` と一致し、HEAD が commit を指し、staged / unstaged / untracked の変更がない。`skip-worktree` が付いた索引エントリーは sparse-checkout を含め拒否する。`core.fsmonitor` を無効化し、`update-index --really-refresh` で `assume-unchanged` のファイルも検査してから `status` を確認する。
- `origin` の取得先と Push 先が、それぞれ `shu-matsukubo/matsu-artifact-delivery` の単一 GitHub URL である。HTTPS または Git SSH の固定形式を許可し、URL 書き換え設定、複数 URL、別リポジトリは拒否する。TLS 検証の無効化・独自 CA の指定と SSH コマンドの差し替えに関わる環境変数・Git 設定も拒否する。HTTPS は既定の信頼ストアを使う。Windows の `http.sslCAInfo` は `C:/Program Files/Git/etc/gitconfig` の system 設定が指定する `C:/Program Files/Git/ucrt64/etc/ssl/certs/ca-bundle.crt` に限定して許可し、両ファイルの実体が固定パスにあることを検証する。
- Push 先が作業ブランチであり、リモートから取得した default branch ではなく、`main`、`master`、`develop`、`development`、`release`、`releases`、`prod`、`production`、`stable` とその配下ではない。
- Git が参照する `info/grafts` が存在しない。worktree では共通 Git ディレクトリの配置先を確認する。
- 既存のリモートブランチを更新する場合、置換 ref を無効にした判定で、その先端が送信する commit の祖先である。リモートの commit がローカルにない場合は、対象を確認して fetch してから検証し直す。
- 検証時のリモート先端を `--force-with-lease` の期待値に指定する。新規作成時は空値を指定し、検証後にブランチが作成・更新された場合は Push を拒否する。

Push は検証した URL と `<commit SHA>:refs/heads/<作業ブランチ>` 一件だけを指定する。祖先関係の確認と先端の一致を条件とし、強制的な履歴の書き換え、削除、mirror、タグ送信、submodule の Push を行わない。pre-push hook は実行しない。GitHub 側の追加の保護ルールはサーバー側で適用される。

`--dry-run` はリモートの読み取りを含む検証を行い、更新せず送信予定を JSON で返す。通常実行は成功時に送信結果を JSON で返す。引数は `--branch` と任意の `--dry-run` に限定する。

認証は対話入力を要求せず、利用可能な credential helper・SSH agent 等を使う。Git の terminal prompt・askpass と credential helper の対話設定を無効化する。SSH は固定実行ファイルに `-F none` と `BatchMode=yes` を指定し、ユーザー・システムの SSH 設定を読み込まない。接続先は `github.com:22`、proxy は無効、ホスト鍵検証は `StrictHostKeyChecking=yes` に固定する。事前に信頼した GitHub のホスト鍵と、既定の鍵または SSH agent による認証を必要とする。Windows ではコマンドを解釈する `C:/Program Files/Git/usr/bin/sh.exe` も検証し、そのディレクトリを PATH の先頭に置く。各 Git コマンドは60秒でタイムアウトとし、Linux / macOS は独立したプロセスグループ、Windows は固定配置の `C:/Windows/System32/taskkill.exe /T /F` で子孫を含め停止して失敗を返す。

## 失敗時

検証・通信・Push の失敗は終了コード 1 とする。作業を破棄せず、接続先、ブランチ、リモートの先端、ローカル差分を確認する。通信失敗では反映結果が不明な場合があるため、リモートを再取得する。競合は強制 Push で解消しない。履歴の統合が必要な場合は人間に判断を返す。

## Codex Rules

[ワークスペースの Rules](../../../../.codex/rules/safe-git.rules)が直接の Push、worktree 削除、`git rm`、ブランチの移動・コピーを含む破壊的な Git コマンドを `forbidden` にする。Git のグローバルオプションでサブコマンドを隠す呼び出しも禁止対象とし、作業ディレクトリはツールの cwd で指定する。

プロジェクトの `.codex/` を信頼し、Codex を再起動して読み込む。[公式 Rules 仕様](https://developers.openai.com/codex/rules)に従い、Rules は sandbox 外のコマンド要求に対する prefix 判定である。別の実行ファイルパス、任意のオプション順、複雑な shell やスクリプト内部の子プロセスを網羅する強制境界ではない。Codex は [AGENTS.md](../../../../AGENTS.md) の禁止も守り、Rules を迂回しない。スクリプト実行は通常の sandbox・承認設定に従う。

```sh
codex execpolicy check --rules .codex/rules/safe-git.rules -- git push origin codex/example
```
