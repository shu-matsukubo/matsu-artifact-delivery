---
name: safe-git
description: このリポジトリで Codex が Git の状態を参照し、指定 commit を取得し、レビュー済みの変更をステージ・Push、または作業ブランチ・コミット・worktree を新規作成するときに使う。引数と接続先を検証する開発専用の手順。
---

# 安全な Git 操作

リポジトリルートで、レビュー・検証済みの差分だけを下記のステージ・新規コミット手順でコミットする。Push 前に作業ツリーを clean にする。[検証の制約と失敗時の扱い](references/push.md)を確認する。

`<作業ブランチ>` を現在のブランチ名に置き換える。信頼する起動済みのシェルで、Node.js の preload、native loader、shell 起動ファイルの環境変数を組み込み機能で除去し、管理者が保護する固定配置の Node.js を使う。`BASH_ENV`・`ENV` を含め、シェル自体の起動時にコードを読み込ませる環境は、管理者がシェルを起動する前に除去する。

Windows は PowerShell で実行する。

```powershell
$ErrorActionPreference = 'Stop'
$env:NODE_OPTIONS = $null
$env:NODE_PATH = $null
$env:BASH_ENV = $null
$env:ENV = $null
Get-ChildItem Env: | Where-Object Name -Match '^(LD_|DYLD_|_?RLD_|LDR_)|^GLIBC_TUNABLES$' | ForEach-Object { [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process') }
& 'C:/Program Files/nodejs/node.exe' .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ> --dry-run
& 'C:/Program Files/nodejs/node.exe' .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ>
```

Linux は起動済みの Bash で次を使う。macOS は Node.js の固定配置を `/usr/local/bin/node` に置き換える。環境変数の除去が完了するまで外部プロセスを起動しない。

```sh
unset NODE_OPTIONS NODE_PATH GLIBC_TUNABLES BASH_ENV ENV || exit 1
for variable in "${!LD_@}" "${!DYLD_@}" "${!_RLD_@}" "${!RLD_@}" "${!LDR_@}"; do
  unset "$variable" || exit 1
done
/usr/bin/node .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ> --dry-run
/usr/bin/node .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ>
```

ステージする場合は、同じ環境変数除去と固定 Node.js の起動手順を使い、実行先を [stage.ts](scripts/stage.ts)、引数を `-- <レビュー済みパス>...` だけにする。リポジトリ内の個別ファイルまたは追跡済み submodule を相対パスで指定する。消失したパスは索引の個別エントリーと完全一致するものを受け付ける。追跡ファイルと指定した新規ファイルの実行可能な filter を事前に拒否し、hook を実行しない。

現在の HEAD から新規作業ブランチを作成する場合は、同じ環境変数除去と固定 Node.js の起動手順を使い、実行先を [create-branch.ts](scripts/create-branch.ts)、引数を `--branch <新規作業ブランチ>` だけにする。既存ブランチの上書き、追加の Git オプション、任意の基点は受け付けない。作業変更と無視ファイルを保全し、checkout hook は実行しない。

ステージ済みの内容から新規コミットを作成する場合は、同じ環境変数除去と固定 Node.js の起動手順を使い、実行先を [commit.ts](scripts/commit.ts)、引数を `--message <コミットメッセージ>` だけにする。親コミットを維持し、未ステージ・未追跡の変更を保全する。追加の Git オプション、hook、署名プログラムは実行しない。

Git の状態を読む場合も同じ起動手順で [read.ts](scripts/read.ts) を使い、`status --short`、`diff --stat`、`notes list`、`remote get-url origin` など、定義された読み取りコマンドとオプションを渡す。別のリポジトリや submodule は先頭に `--cwd <リポジトリの絶対パス>` を指定する。グローバルオプション、更新コマンド、外部 diff・textconv、出力先ファイルの指定は拒否する。

指定 commit の取得には、同じ起動手順で [fetch.ts](scripts/fetch.ts) に `--commit <取得する commit SHA>` を渡す。Push と共通の接続先・TLS・認証検証を行い、指定 object を取得する。既存の ref・索引・作業変更・`FETCH_HEAD` を保全する。

隔離作業ツリーは同じ起動手順で [create-worktree.ts](scripts/create-worktree.ts) に `--path <未使用の絶対パス> --commit <取得済み commit SHA>` を渡す。元リポジトリの外に、指定したローカル commit の detached worktree を新規作成する。ブランチ・既存の配置・作業変更を保全し、hook と対象 commit の外部 filter を拒否する。commit がローカルにない場合は `fetch.ts` で取得してから実行する。

検証失敗時は Git 操作を行わない。拒否を直接の `git add`・`git push`・`git commit`、別スクリプト、Git alias、グローバルオプション、API による強制更新等で回避しない。再試行は現在状態を確認し、原因を解消してから行う。
