# matsu-artifact-delivery

成果物の作成フローと、設計・セキュリティ・変更影響の相談を支援する Plugin 集です。Codex を主な実行環境とします。

## Plugin

| Plugin | 機能 |
| --- | --- |
| [artifact-workflow](plugins/artifact-workflow/README.md) | 作業を計画し、承認後に成果物を生成・レビュー・検証して引き渡す。 |
| [expert-escalation](plugins/expert-escalation/README.md) | 親の明示依頼で、限定した論点を読み取り専用の相談役へ渡す。 |

## Codex で使う

公開 Plugins Directory にはまだ掲載していません。掲載までは GitHub marketplace から利用できます。Codex がリポジトリを取得するため、利用者が自分で clone する必要はありません。

```sh
codex plugin marketplace add shu-matsukubo/matsu-artifact-delivery
codex plugin add artifact-workflow@matsu-artifact-delivery
# または
codex plugin add expert-escalation@matsu-artifact-delivery
```

`artifact-workflow` の MCP 起動には Node.js 22.19 以降が必要です。利用者は npm の実行や `dist/` の生成を必要としません。MCP サーバーを変更する開発者向けのビルド・試験手順は[配布と更新](docs/distribution.md)を参照してください。

OpenAI の審査・公開後は Plugins Directory から検索してインストールできるようになります。公開条件と各 Plugin の機能詳細は[配布と更新](docs/distribution.md)および各 Plugin の README を参照してください。

## 開発資料

開発時の基本方針と資料の案内は [AGENTS.md](AGENTS.md) にあります。必要に応じて、[製造・レビュー観点](docs/manufacturing-review.md)、[テスト・検証観点](docs/testing-review.md)、[試験と差分 CI](docs/testing.md)を参照してください。

## ライセンス

MIT License。条件は [LICENSE](LICENSE) を参照してください。
