---
name: safe-git
description: このリポジトリで Codex がレビュー済みの作業ブランチを Push するときに使う。接続先とブランチを検証する開発専用の手順。
---

# 安全な Push

リポジトリルートで、レビュー・検証済みの差分だけをコミットし、作業ツリーを clean にする。[Push の制約と失敗時の扱い](references/push.md)を確認する。

`<作業ブランチ>` を現在のブランチ名に置き換えて実行する。

```sh
node .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ> --dry-run
node .agents/skills/safe-git/scripts/push.ts --branch <作業ブランチ>
```

検証失敗時は Push しない。拒否を直接の `git push`、別スクリプト、Git alias、グローバルオプション、API による強制更新等で回避しない。再試行はリモートの現在状態を確認し、原因を解消してから行う。
