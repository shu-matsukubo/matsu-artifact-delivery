# matsu-artifact-delivery

成果物の作成フローと、設計・セキュリティ・変更影響の相談を支援する Plugin 集です。Codex を主な実行環境とします。

## Plugin

| Plugin | 機能 |
| --- | --- |
| [artifact-workflow](plugins/artifact-workflow/README.md) | 作業を計画し、承認後に成果物を生成・レビュー・検証して引き渡す。 |
| [expert-escalation](plugins/expert-escalation/README.md) | 親の明示依頼で、限定した論点を読み取り専用の相談役へ渡す。 |

## Codex で使う

公開 Plugins Directory への掲載前は、開発用 marketplace から試せます。リポジトリのルートで次を実行し、Codex アプリで `matsu-artifact-delivery` から必要な Plugin をインストールしてください。

```sh
codex plugin marketplace add .
```

MCP サーバーを変更した開発者は、先に生成済み bundle を更新してください。通常の利用者は `dist/` の生成や npm の実行を必要としません。

公開版は OpenAI の審査・公開後に Plugins Directory から検索してインストールできます。公開状況とローカル MCP サーバーの配布条件を含む手順は[配布と更新](docs/distribution.md)を参照してください。導入要件と機能の詳細は各 Plugin の README を参照してください。

## 開発資料

開発時の基本方針と資料の案内は [AGENTS.md](AGENTS.md) にあります。必要に応じて、[製造・レビュー観点](docs/manufacturing-review.md)、[テスト・検証観点](docs/testing-review.md)、[試験と差分 CI](docs/testing.md)を参照してください。

## ライセンス

MIT License。条件は [LICENSE](LICENSE) を参照してください。
