[English](README.md) | 日本語

# matsu-artifact-delivery

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![artifact-workflow version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshu-matsukubo%2Fmatsu-artifact-delivery%2Fmain%2Fplugins%2Fartifact-workflow%2Fplugin.json&query=%24.version&label=artifact-workflow)](plugins/artifact-workflow/plugin.json)
[![expert-escalation version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshu-matsukubo%2Fmatsu-artifact-delivery%2Fmain%2Fplugins%2Fexpert-escalation%2Fplugin.json&query=%24.version&label=expert-escalation)](plugins/expert-escalation/plugin.json)
![Status: Development](https://img.shields.io/badge/status-development-yellow.svg)
[![MCP: Windows x64 only](https://img.shields.io/badge/MCP-Windows%20x64%20only-lightgrey.svg)](plugins/artifact-workflow/README.ja.md#mcp-runtime)

成果物の作成フローと、設計・セキュリティ・変更影響に関する読み取り専用の相談を支援する Codex Plugin 集です。

## Plugin

| Plugin                                                      | 概要                                                                                     | 説明                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [artifact-workflow](plugins/artifact-workflow/README.ja.md) | 作業を計画し、承認後に成果物の生成・独立レビュー・検証を調整します。                     | [README](plugins/artifact-workflow/README.ja.md) |
| [expert-escalation](plugins/expert-escalation/README.ja.md) | 明示依頼された論点を読み取り専用の相談役へ渡し、元の担当が作業を続けられるようにします。 | [README](plugins/expert-escalation/README.ja.md) |

## Codex へのインストール

GitHub marketplace を追加すると Codex がリポジトリを取得します。必要な Plugin をインストールしてください。

```sh
codex plugin marketplace add shu-matsukubo/matsu-artifact-delivery
codex plugin add artifact-workflow@matsu-artifact-delivery
# または
codex plugin add expert-escalation@matsu-artifact-delivery
```

`artifact-workflow` に同梱された MCP runtime は Windows x64 向けです。この制約は当該 runtime に適用され、`expert-escalation` の対応環境を制限しません。

## 開発・配布

開発方針は [AGENTS.md](AGENTS.md)、ビルド・パッケージ・公開 Plugins Directory への提出条件は[配布と更新](docs/distribution.md)を参照してください。必要に応じて[製造・レビュー観点](docs/manufacturing-review.md)、[テスト・検証観点](docs/testing-review.md)、[試験と差分 CI](docs/testing.md)も確認してください。

## ライセンス

本 Plugin 集は MIT License で提供します。条件は [LICENSE](LICENSE) を参照してください。
