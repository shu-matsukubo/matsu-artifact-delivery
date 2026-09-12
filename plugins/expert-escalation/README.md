# expert-escalation

設計・セキュリティ・変更影響などの具体的な阻害要因について、上位の相談役へ読み取り専用で助言・レビューを依頼する独立した Plugin です。実装や検証は元の担当が続けます。特定の Workflow や成果物形式に依存しません。

自動相談は親・全ワーカー・全論点を合算して、現在の作業開始からユーザーへの返答で作業を中断するまで、最大3回です。ユーザーの返答で再開するときに0回へリセットし、以前の試行履歴は残します。チャット全体の累計上限ではありません。解決できなければ作業を一度中断し、試行内容・失敗理由・選択肢を報告してユーザー判断を仰ぎます。通常作業や定例レビューでは介入しません。

## 用意しているもの

| 内容 | 正本 |
| --- | --- |
| 呼び出し手順と基本的な境界 | [SKILL.md](skills/expert-escalation/SKILL.md) |
| 呼び出すタイミング | [triggers.md](skills/expert-escalation/references/triggers.md) |
| 原理原則、共有回数、中断・再開 | [principles.md](skills/expert-escalation/references/principles.md) |
| 相談役の役割・入力・返却項目 | [advisor-contract.md](skills/expert-escalation/references/advisor-contract.md) |
| ユーザー判断のための報告テンプレート | [escalation-result-template.md](skills/expert-escalation/assets/escalation-result-template.md) |
| 通常の相談役（初期設定は Sol） | [escalation-advisor.toml](com.openai/agents/escalation-advisor.toml) |
| 難所を再検討する相談役（初期設定は Astra） | [escalation-deep-advisor.toml](com.openai/agents/escalation-deep-advisor.toml) |

両方とも単体モデルの最大推論を使い、具体的なモデル名・推論強度は TOML の `model` と `model_reasoning_effort` で管理します。変更は役割定義に閉じ、呼び出し元の Workflow や Skill にモデル選択を埋め込みません。役割の使い分けは[相談役の契約](skills/expert-escalation/references/advisor-contract.md)を参照してください。

OpenAI の [Max / Ultra の説明](https://learn.chatgpt.com/docs/models#know-when-to-use-max-or-ultra)に従い、初期設定は単体の推論を最大にする `max` としています。`ultra` は自動再委任を含む実行モードです。相談役には再委任させず、`agents.enabled = false` も設定しています。

## 親・ワーカーからの利用

Skill は自動選択を許可しています。明示的に使う場合は、例えば「`expert-escalation` で、この設計案が必須条件を満たせるか相談してください」と依頼します。実際の相談役の起動には Skill 内の発火条件と回数管理を適用します。

親・ワーカーなど誰でも相談要求を作れます。回数管理と相談役の起動は現在の作業全体の親1人に集約し、ワーカーからは親へ中継します。ワーカー自身に子エージェントの起動権限がなくても、この経路で利用できます。相談役の起動は直列に行い、同時発火による上限超過や深い再委任を避けます。単独のエージェントは自分を管理者として同じ手順を使います。

既存の Workflow と組み合わせる場合、読み取り専用の相談を任意で利用できることと、ワーカーから管理者へ相談を返す経路が必要です。このリポジトリの `artifact-workflow` はその接点を持ちますが、本 Plugin を必須依存にはしていません。工程の責任、計画への承認、通常のレビュー・完了判定は元の Workflow が保持します。

## 共通規格と Codex 互換設定

[Agent Plugins Specification](https://agent-plugins.org/specification) と [Agent Skills Specification](https://agentskills.io/specification)を共通部分の基準にしています。

| 場所 | 扱い |
| --- | --- |
| [plugin.json](plugin.json) | 共通の識別情報・リリースバージョンの正本。`$schema` で対象規格を宣言する。 |
| `skills/expert-escalation/` | 共通の Skill 検出位置。手順・参照資料・テンプレートを同じ Skill 配下にまとめる。 |
| `com.openai/agents/` | Codex 固有のモデル・権限・役割定義。[client extensions](https://agent-plugins.org/plugin-authors/client-extensions)の逆ドメイン配置に合わせる。自動登録用のディレクトリではない。 |
| [.codex-plugin/plugin.json](.codex-plugin/plugin.json) | plugin-creator が生成する Codex 互換用 manifest。共通 manifest の識別情報に Codex の Skill 位置・表示情報を加える。 |
| [skills/expert-escalation/agents/openai.yaml](skills/expert-escalation/agents/openai.yaml) | Codex 向けの表示情報と `allow_implicit_invocation: true`。 |

`.codex-plugin/plugin.json` と Skill の `agents/openai.yaml` は、Codex の既存の読み込み位置を維持する互換性上の例外です。共通規格のコンポーネントを増やす独自の検出方式ではなく、Codex 固有の設定として扱います。[Plugin パッケージ](https://developers.openai.com/plugins/build/plugins)と[Skill の optional metadata](https://learn.chatgpt.com/docs/build-skills#optional-metadata)を参照してください。manifest の共通フィールドは root を正本とし、変更時は互換 manifest の同名フィールドにも同期します。

MCP、外部 API、中央ログ、専用のリスクスコアは追加していません。Custom Agent、モデル選択、sandbox、共有回数の実行管理は Agent Plugins の共通仕様に含まれません。他の client では同等の読み取り専用の相談役と管理者を用意してください。

## Codex への登録

リポジトリのマーケットプレイスを未登録の場合は、リポジトリのルートで登録します。

```sh
codex plugin marketplace add .
```

Codex アプリでこのマーケットプレイスの `expert-escalation` をインストールし、次の役割登録を確認したうえで新しいタスクを開始します。Plugin のインストールだけでは Custom Agent の参照設定は追加されません。

このリポジトリでは [../../.codex/config.toml](../../.codex/config.toml) に登録しています。別の作業場所では、そのプロジェクトの `.codex/config.toml`（個人共通なら `~/.codex/config.toml`）に以下を追加し、パスを同梱 TOML の実際の絶対パスへ置き換えてください。

```toml
[agents.escalation-advisor]
config_file = "C:/path/to/matsu-artifact-delivery/plugins/expert-escalation/com.openai/agents/escalation-advisor.toml"

[agents.escalation-deep-advisor]
config_file = "C:/path/to/matsu-artifact-delivery/plugins/expert-escalation/com.openai/agents/escalation-deep-advisor.toml"
```

本リポジトリは既存設定と同じ `agents.<name>.config_file` による登録を使います。利用する Codex が独立 TOML の自動検出を使う場合は、[Custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents)に従って同じ定義を利用先の `.codex/agents/` または `~/.codex/agents/` に配置します。同名の役割を両方の方式で重複登録しないでください。

## 実行上の境界

- 役割・モデルが利用不能なら成功にせず、事前確認で停止したか、起動後に失敗したかを記録します。別モデルへの自動置き換えはしません。
- `sandbox_mode = "read-only"` と `approval_policy = "never"` を設定し、相談役が書き込みや権限拡大を求める動作を避けます。sandbox は外部コネクタの書き込み全般を強制禁止する仕組みではないため、役割の指示でも禁止しています。
- 3回上限は、管理者が保持する記録と起動前の確保による運用上の制約です。全 client のツール呼び出しを機械的に遮断する仕組みは同梱していません。管理者と記録を確立できない場合は自動相談を開始しません。

設定の詳細は OpenAI 公式の [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)を参照してください。
