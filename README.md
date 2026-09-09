# matsu-codex-plugins

独立して利用可能な Codex Plugin をまとめるリポジトリです。各 Plugin は、それぞれ単独で利用できるワークフローを提供します。

## Plugin 一覧

| Plugin | 目的 |
| --- | --- |
| [artifact-workflow](plugins/artifact-workflow/README.md) | 成果物の形式を問わず、タスク分解・計画の提示・承認・生成・セルフレビュー・検証・成果物の提示を進める。 |

## 利用方法

リポジトリのルートで、マーケットプレイスを登録します。

```sh
codex plugin marketplace add .
```

Codex アプリを再起動し、Plugin 一覧でこのリポジトリのマーケットプレイスを選び、`artifact-workflow` をインストールしてください。インストール後は新しいタスクで利用します。

`artifact-workflow` は成果物の生成・修正とセルフレビューを最低1人、同時に最大3人の Custom Agent `artifact-worker` に委任します。独立したタスクの並列実行は親が判断し、計画・承認・検証・提示も親が管理します。このリポジトリでは [.codex/config.toml](.codex/config.toml) に役割の参照を登録しています。別の作業場所で利用する場合は、[Custom Agent の設定と登録](plugins/artifact-workflow/README.md#custom-agent-の設定と登録)も行ってください。

カタログは [.agents/plugins/marketplace.json](.agents/plugins/marketplace.json)、Plugin 本体は `plugins/` に配置しています。カタログ内の `source.path` はリポジトリのルートを基準とする相対パスです。

構成は、2026年9月8日に確認した OpenAI 公式の [Plugin パッケージ仕様](https://developers.openai.com/plugins/build/plugins)と[Agent Skills の説明](https://learn.chatgpt.com/docs/build-skills)に基づいています。
