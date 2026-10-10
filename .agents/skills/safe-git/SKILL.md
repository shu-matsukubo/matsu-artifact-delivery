---
name: safe-git
description: このリポジトリで Codex が作業ブランチを新規作成、またはレビュー済みの変更を Push するときに使う。引数と接続先を検証する開発専用の手順。
---

# 安全な Push

リポジトリルートで、レビュー・検証済みの差分だけをコミットし、作業ツリーを clean にする。[Push の制約と失敗時の扱い](references/push.md)を確認する。

`<作業ブランチ>` を現在のブランチ名に置き換える。信頼する起動済みのシェルで、Node.js の preload と native loader の環境変数を組み込み機能で除去し、管理者が保護する固定配置の Node.js を使う。シェル自体の起動時にコードを読み込ませる環境は、管理者がシェルを起動する前に除去する。

Windows は PowerShell で実行する。

```powershell
$ErrorActionPreference = 'Stop'
$env:NODE_OPTIONS = $null
$env:NODE_PATH = $null
Get-ChildItem Env: | Where-Object Name -Match '^(LD_|DYLD_|_?RLD_|LDR_)|^GLIBC_TUNABLES$' | ForEach-Object { [Environment]::SetEnvironmentVariable($_.Name, $null, 'Process') }
& 'C:/Program Files/nodejs/node.exe' .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ> --dry-run
& 'C:/Program Files/nodejs/node.exe' .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ>
```

Linux は起動済みの Bash で次を使う。macOS は Node.js の固定配置を `/usr/local/bin/node` に置き換える。環境変数の除去が完了するまで外部プロセスを起動しない。

```sh
unset NODE_OPTIONS NODE_PATH GLIBC_TUNABLES || exit 1
for variable in "${!LD_@}" "${!DYLD_@}" "${!_RLD_@}" "${!RLD_@}" "${!LDR_@}"; do
  unset "$variable" || exit 1
done
/usr/bin/node .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ> --dry-run
/usr/bin/node .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ>
```

現在の HEAD から新規作業ブランチを作成する場合は、同じ環境変数除去と固定 Node.js の起動手順を使い、実行先を [create-branch.ts](scripts/create-branch.ts)、引数を `--branch <新規作業ブランチ>` だけにする。既存ブランチの上書き、追加の Git オプション、任意の基点は受け付けない。作業変更と無視ファイルを保全し、checkout hook は実行しない。

検証失敗時は Push しない。拒否を直接の `git push`、別スクリプト、Git alias、グローバルオプション、API による強制更新等で回避しない。再試行はリモートの現在状態を確認し、原因を解消してから行う。
