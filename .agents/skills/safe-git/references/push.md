# Push の制約

開発用の Node.js 22.19.0 以降と Git を使う。利用者向け Plugin の実行要件や配布物には追加しない。人間が通常のターミナルで行う Git 操作は対象外とする。

## 検証と更新

[スクリプト](../scripts/push.ts)は次を確認する。

- スクリプトの配置先が Git リポジトリのルートに対応し、そのルートから実行されている。
- 現在のブランチが `--branch` と一致し、HEAD が commit を指し、staged / unstaged / untracked の変更がない。
- `origin` の取得先と Push 先が、それぞれ `shu-matsukubo/matsu-artifact-delivery` の単一 GitHub URL である。HTTPS または Git SSH の固定形式を許可し、URL 書き換え設定、複数 URL、別リポジトリは拒否する。
- Push 先が作業ブランチであり、リモートから取得した default branch ではなく、`main`、`master`、`develop`、`development`、`release`、`releases`、`prod`、`production`、`stable` とその配下ではない。
- 既存のリモートブランチを更新する場合、その先端が送信する commit の祖先である。リモートの commit がローカルにない場合は、対象を確認して fetch してから検証し直す。
- 検証時のリモート先端を `--force-with-lease` の期待値に指定する。新規作成時は空値を指定し、検証後にブランチが作成・更新された場合は Push を拒否する。

Push は検証した URL と `<commit SHA>:refs/heads/<作業ブランチ>` 一件だけを指定する。祖先関係の確認と先端の一致を条件とし、強制的な履歴の書き換え、削除、mirror、タグ送信、submodule の Push を行わない。pre-push hook は実行しない。GitHub 側の追加の保護ルールはサーバー側で適用される。

`--dry-run` はリモートの読み取りを含む検証を行い、更新せず送信予定を JSON で返す。通常実行は成功時に送信結果を JSON で返す。引数は `--branch` と任意の `--dry-run` に限定する。

## 失敗時

検証・通信・Push の失敗は終了コード 1 とする。作業を破棄せず、接続先、ブランチ、リモートの先端、ローカル差分を確認する。通信失敗では反映結果が不明な場合があるため、リモートを再取得する。競合は強制 Push で解消しない。履歴の統合が必要な場合は人間に判断を返す。

## Codex Rules

[ワークスペースの Rules](../../../../.codex/rules/safe-git.rules)が直接の Push と破壊的な Git コマンドを `forbidden` にする。Git のグローバルオプションでサブコマンドを隠す呼び出しも禁止対象とし、作業ディレクトリはツールの cwd で指定する。

プロジェクトの `.codex/` を信頼し、Codex を再起動して読み込む。[公式 Rules 仕様](https://developers.openai.com/codex/rules)に従い、Rules は sandbox 外のコマンド要求に対する prefix 判定である。別の実行ファイルパス、任意のオプション順、複雑な shell やスクリプト内部の子プロセスを網羅する強制境界ではない。Codex は [AGENTS.md](../../../../AGENTS.md) の禁止も守り、Rules を迂回しない。スクリプト実行は通常の sandbox・承認設定に従う。

```sh
codex execpolicy check --rules .codex/rules/safe-git.rules -- git push origin codex/example
```
