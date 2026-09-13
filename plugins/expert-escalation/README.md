# expert-escalation

設計・セキュリティ・変更影響などの具体的な阻害要因について、上位の相談役へ読み取り専用で助言・レビューを依頼する独立した Plugin です。実装や検証は元の担当が続けます。特定の Workflow や成果物形式に依存しません。

ユーザーまたは呼び出し元の親が明示的に指定した場合だけ利用します。本 Plugin 自体は累計の回数制限を持たず、明示依頼ごとに相談できます。呼び過ぎを防ぐ上限、再試行、実行枠、継続・停止の判断は呼び出し元の親が管理します。相談不能と作業全体の中断を分け、通常作業へ自動的には介入しません。

## 用意しているもの

| 内容 | 正本 |
| --- | --- |
| 呼び出し手順と基本的な境界 | [SKILL.md](skills/expert-escalation/SKILL.md) |
| 明示依頼で相談する論点の例 | [triggers.md](skills/expert-escalation/references/triggers.md) |
| 原理原則、起動主体、呼び出し元との責務境界 | [principles.md](skills/expert-escalation/references/principles.md) |
| 相談役の役割・入力・返却項目 | [advisor-contract.md](skills/expert-escalation/references/advisor-contract.md) |
| 相談結果と親の対応判断のテンプレート | [escalation-result-template.md](skills/expert-escalation/assets/escalation-result-template.md) |
| 通常の相談役（初期設定は Sol） | [escalation-advisor.toml](com.openai/agents/escalation-advisor.toml) |
| 難所を再検討する相談役（初期設定は Astra） | [escalation-deep-advisor.toml](com.openai/agents/escalation-deep-advisor.toml) |

両方とも単体モデルの最大推論を使い、具体的なモデル名・推論強度は TOML の `model` と `model_reasoning_effort` で管理します。変更は役割定義に閉じ、呼び出し元の Workflow や Skill にモデル選択を埋め込みません。役割の使い分けは[相談役の契約](skills/expert-escalation/references/advisor-contract.md)を参照してください。

OpenAI の [Max / Ultra の説明](https://learn.chatgpt.com/docs/models#know-when-to-use-max-or-ultra)に従い、初期設定は単体の推論を最大にする `max` としています。`ultra` は自動再委任を含む実行モードです。相談役には再委任させず、`agents.enabled = false` も設定しています。

## 親・ワーカーからの利用

例えば「`$expert-escalation` で、この設計案が必須条件を満たせるか相談してください」と依頼します。Codex では `allow_implicit_invocation: true` とし、通常のモデル向け一覧へ名前・説明・パスを公開します。設定上は暗黙選択を許可し、相談の開始条件は Skill の description と本文で「ユーザーまたは呼び出し元の親の明示依頼」に制限します。一覧への掲載や本文の読み込みだけでは相談を開始しません。[公式の呼び出し設定](https://learn.chatgpt.com/docs/build-skills#optional-metadata)を参照してください。

呼び出し元の親は、現在のタスクで利用可能として提示された実際のパスから `SKILL.md` を読み、その契約に従って1件の相談を明示的に依頼します。client の正式な一覧機能を使う場合も、現在のタスクの設定が反映された一覧に限ります。`artifact-workflow` には[発見・読み込み手順](../artifact-workflow/skills/artifact-workflow/references/escalation.md#相談-skill-の発見読み込み)を定義しています。候補が見つからない・無効・本文を読めない場合は相談を見送り、発見のための Python や Codex CLI の追加起動は行いません。

相談役の起動は現在の作業全体の親だけが行います。子ワーカーは問い・証拠・試した方法を親へ返し、本 Skill や相談役を直接起動しません。子の依頼を受けた親が、相談の必要性と今回の呼び出しを判断します。単独作業では自分が親になります。親の識別には実行環境のID・正規名（取得できなければ作業IDと一意な親ラベルの組）を使い、相談IDとともに結果へ引き継ぎます。固定の親名や専用の親役割を追加する必要はありません。

相談役は生成ワーカーとは別の役割として管理します。ただし client の同時起動枠が共通なら、親が相談用に1枠を予約するか、成果物・実行状態・再開情報を保全して枠を解放します。全ワーカーが相談待ちのまま完了を待ち続けません。枠を確保できなければ起動を試さず、利用不能として親の判断へ戻します。

既存の Workflow と組み合わせる場合は、親へ相談依頼を返す経路と、親側の呼び出し方針を用意します。このリポジトリの `artifact-workflow` は[呼び出し元の方針](../artifact-workflow/skills/artifact-workflow/references/escalation.md)に自律相談の上限とフォールバックを持ち、本 Plugin を必須依存にはしていません。工程の責任、計画への承認、通常のレビュー・完了判定は元の Workflow が保持します。生成中の設計判断にも、後続の GitHub 提出・公開に関する判断にも、同じ相談契約を利用できます。

## 共通規格と Codex 互換設定

[Agent Plugins Specification](https://agent-plugins.org/specification) と [Agent Skills Specification](https://agentskills.io/specification)を共通部分の基準にしています。

| 場所 | 扱い |
| --- | --- |
| [plugin.json](plugin.json) | 共通の識別情報・リリースバージョンの正本。`$schema` で対象規格を宣言する。 |
| `skills/expert-escalation/` | 共通の Skill 検出位置。手順・参照資料・テンプレートを同じ Skill 配下にまとめる。 |
| `com.openai/agents/` | Codex 固有のモデル・権限・役割定義。[client extensions](https://agent-plugins.org/plugin-authors/client-extensions)の逆ドメイン配置に合わせる。自動登録用のディレクトリではない。 |
| [.codex-plugin/plugin.json](.codex-plugin/plugin.json) | plugin-creator が生成する Codex 互換用 manifest。共通 manifest の識別情報に Codex の Skill 位置・表示情報を加える。 |
| [skills/expert-escalation/agents/openai.yaml](skills/expert-escalation/agents/openai.yaml) | Codex 向けの表示情報と `allow_implicit_invocation: true`。相談の開始条件は Skill の description と本文で管理する。 |

`.codex-plugin/plugin.json` と Skill の `agents/openai.yaml` は、Codex の既存の読み込み位置を維持する互換性上の例外です。共通規格のコンポーネントを増やす独自の検出方式ではなく、Codex 固有の設定として扱います。[Plugin パッケージ](https://developers.openai.com/plugins/build/plugins)と[Skill の optional metadata](https://learn.chatgpt.com/docs/build-skills#optional-metadata)を参照してください。manifest の共通フィールドは root を正本とし、変更時は互換 manifest の同名フィールドにも同期します。

MCP、外部 API、中央ログ、専用のリスクスコアは追加していません。Custom Agent、モデル選択、sandbox、同時起動枠の管理は Agent Plugins の共通仕様に含まれません。他の client では同等の読み取り専用の相談役と親による明示呼び出しの経路を用意してください。

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

- 事前確認で役割未登録・環境不備・枠不足が分かった場合は `unavailable`、`attempted: false` を返します。起動を試した後の失敗・結果未取得は `no_result`、`attempted: true` と実行状態を返します。別モデルへの自動置き換えはしません。
- `sandbox_mode = "read-only"` と `approval_policy = "never"` を設定し、相談役が書き込みや権限拡大を求める動作を避けます。sandbox は外部コネクタの書き込み全般を強制禁止する仕組みではないため、役割の指示でも禁止しています。
- 消費回数と上限到達は呼び出し元が判定します。相談結果から自力での継続・該当作業だけの停止・全体停止を選ぶのも親です。本 Plugin は全ワーカーの停止を要求せず、相談役も回数を理由に依頼を拒否しません。

設定の詳細は OpenAI 公式の [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)を参照してください。
