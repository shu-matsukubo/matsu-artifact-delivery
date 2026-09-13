# matsu-artifact-delivery

成果物を利用者へ届けるデリバリーを支援するプラグイン集です。`artifact-workflow` が成果物生成フローを担当し、生成・品質確認後の更新・公開・提出は、親エージェントが依頼に応じたデリバリー手段で続行します。`expert-escalation` は両方の場面で使える共通の相談機能を担当します。成果物・引き渡し情報と相談の入出力契約を接点にして、それぞれの役割を独立させます。[Agent Plugins](https://agent-plugins.org/) の共通規格を基準とし、当面は Codex を主な実行環境とします。

## Plugin 一覧

| Plugin | 目的 |
| --- | --- |
| [artifact-workflow](plugins/artifact-workflow/README.md) | 成果物を作る作業タスクを計画・承認し、生成・セルフレビュー・タスクと全体の検証を行う。完成品と検証結果を提示・引き渡してフローを終了し、後続処理の実行・検証は管理しない。 |
| [expert-escalation](plugins/expert-escalation/README.md) | 親からの明示依頼で設計・セキュリティ・変更影響の論点を読み取り専用の相談役へ渡し、結果を返す。回数制限・実行枠・継続や停止の判断は呼び出し元の親が管理する。 |

## 共通規格への方針

共通化できる部分は [Agent Plugins Specification](https://agent-plugins.org/specification) と [Agent Skills Specification](https://agentskills.io/specification) を優先します。新しい Plugin や機能を追加するときも、まず既存の共通規格で表現できるかを確認し、独自 manifest や独自の Skill 検出方式は明確な理由がない限り追加しません。

| 場所 | 扱い |
| --- | --- |
| `plugins/<plugin>/plugin.json` | 共通の識別情報とメタデータ。`$schema` で対象規格を宣言する。 |
| `plugins/<plugin>/skills/<name>/SKILL.md` | 共通の Skill 検出位置と定義。Skill 固有の `scripts/`・`references/`・`assets/` は同じ Skill 配下へ置く。 |
| `plugins/<plugin>/mcp.json` | MCP を追加するときの共通設定。`plugin.json` と同じ規格バージョンの MCP schema を使う。 |
| `plugins/<plugin>/com.openai/` | Codex 向けの固有ファイル。共通コンポーネントとは分けて配置する。 |
| `.agents/plugins/marketplace.json`・`.codex/config.toml` | Codex 向けの配布カタログ・利用先の設定。Plugin パッケージの共通規格には含まれない。 |

client 固有の manifest データが必要になった場合は、逆ドメイン形式の `extensions` 名前空間を使います。OpenAI 向けは `extensions.com.openai` とし、固有ファイルは対応する `com.openai/` 配下へまとめます。client が特定の読み込み位置を要求する互換設定は、理由と共通規格との差分を各 Plugin の README に記載します。現在の例外は [artifact-workflow の Codex 互換設定](plugins/artifact-workflow/README.md#codex-互換設定)と [expert-escalation の互換設定](plugins/expert-escalation/README.md#共通規格と-codex-互換設定)を参照してください。

Custom Agent、モデル、推論強度などの Codex 固有機能は維持しつつ、共通仕様の必須要素とは区別します。各 Plugin の README には、インストールで利用可能になる部分と追加設定が必要な部分を明記します。全 client での同一動作を必須にはせず、将来の移植に不要な独自構造を増やさない方針です。

Plugin のリリースバージョンと対象規格は、各 Plugin の `plugin.json` を正本とします。README は概要と参照先を中心に記載し、リリースバージョンなど更新のたびに同期が必要になる値を複製しません。詳細なワークフローは Skill と参照資料、モデル・推論強度は Custom Agent 定義で管理します。

## Codex での利用方法

リポジトリのルートで、マーケットプレイスを登録します。

```sh
codex plugin marketplace add .
```

Codex アプリを再起動し、Plugin 一覧でこのリポジトリのマーケットプレイスを選び、利用する Plugin をインストールしてください。インストール後は新しいタスクで利用します。

`artifact-workflow` の実行要件とワークフローは [Plugin README](plugins/artifact-workflow/README.md)を参照してください。このリポジトリでは [.codex/config.toml](.codex/config.toml) に役割の参照を登録しています。別の作業場所で利用する場合は、[Custom Agent の設定と登録](plugins/artifact-workflow/README.md#custom-agent-の設定と登録)も行ってください。

`expert-escalation` の明示呼び出し・返却契約・役割登録は [Plugin README](plugins/expert-escalation/README.md)を参照してください。単独では明示依頼ごとに利用でき、Plugin 自体に累計の回数制限はありません。Workflow と組み合わせる場合は、親が呼び過ぎを制御します。`artifact-workflow` の上限とフォールバックは[呼び出し元の方針](plugins/artifact-workflow/skills/artifact-workflow/references/escalation.md)で管理します。

カタログは [.agents/plugins/marketplace.json](.agents/plugins/marketplace.json)、Plugin 本体は `plugins/` に配置しています。カタログ内の `source.path` はリポジトリのルートを基準とする相対パスです。

Codex 向けの配布と設定は、OpenAI 公式の [Plugin パッケージの説明](https://developers.openai.com/plugins/build/plugins)と[Skill の説明](https://learn.chatgpt.com/docs/build-skills)を参照してください。
