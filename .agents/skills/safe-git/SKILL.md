---
name: safe-git
description: このリポジトリで Codex が作業ブランチを新規作成、またはレビュー済みの変更を Push するときに使う。引数と接続先を検証する開発専用の手順。
---

# 安全な Push

リポジトリルートで、レビュー・検証済みの差分だけをコミットし、作業ツリーを clean にする。[Push の制約と失敗時の扱い](references/push.md)を確認する。

`<作業ブランチ>` を現在のブランチ名に置き換える。Node.js の起動前に呼び出し元のシェルで `NODE_OPTIONS` と `NODE_PATH` を除去し、管理者が保護する固定配置の Node.js を使う。

Windows は PowerShell で実行する。

```powershell
$env:NODE_OPTIONS = $null
$env:NODE_PATH = $null
& 'C:/Program Files/nodejs/node.exe' .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ> --dry-run
& 'C:/Program Files/nodejs/node.exe' .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ>
```

Linux は次を使う。macOS は Node.js の固定配置を `/usr/local/bin/node` に置き換える。

```sh
/usr/bin/env -u NODE_OPTIONS -u NODE_PATH /usr/bin/node .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ> --dry-run
/usr/bin/env -u NODE_OPTIONS -u NODE_PATH /usr/bin/node .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ>
```

現在の HEAD から新規作業ブランチを作成する場合は、同じ環境変数除去と固定 Node.js の起動手順を使い、実行先を [create-branch.ts](scripts/create-branch.ts)、引数を `--branch <新規作業ブランチ>` だけにする。既存ブランチの上書き、追加の Git オプション、任意の基点は受け付けない。作業変更と無視ファイルを保全し、checkout hook は実行しない。

検証失敗時は Push しない。拒否を直接の `git push`、別スクリプト、Git alias、グローバルオプション、API による強制更新等で回避しない。再試行はリモートの現在状態を確認し、原因を解消してから行う。
