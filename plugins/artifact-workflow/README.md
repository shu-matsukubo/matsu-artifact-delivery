# artifact-workflow

デリバリーを支援するプラグイン集のうち、成果物生成フローを担当する Plugin です。作業タスク計画へのユーザー承認、生成・セルフレビュー、タスクと全体の検証を行い、完成品と検証結果の提示・引き渡しで終了します。[Agent Plugins](https://agent-plugins.org/) の共通構造で Skill を配布し、Codex 向けに Custom Agent の定義を同梱しています。

コード、ドキュメント、プレゼン資料、調査レポートなど、作るものと完了条件を合意してから作業したい場面で利用できます。特定の開発工程・言語・フレームワーク・成果物形式には依存せず、他の Plugin や Skill、外部サービスなしで単独利用できます。実行に必要な Codex 側の登録は後述します。

更新・公開・提出などの後続処理には、依頼に応じた手段を組み合わせます。生成フローとの接点は完成品・検証結果・必要な引き渡し情報とし、後続処理の実行方法・検証・成功条件は担当側に委ねます。特定の Plugin・Skill・外部サービスの操作手順を生成フローに組み込まず、疎結合に保ちます。

## 共通部分と Codex 固有部分

共通化できる内容は [Agent Plugins Specification](https://agent-plugins.org/specification) と [Agent Skills Specification](https://agentskills.io/specification) を優先します。今後の機能追加でも、共通規格で表現できる内容は共通側へ置き、client 固有の設定は分離します。

| 場所 | 区分と責務 |
| --- | --- |
| [plugin.json](plugin.json) | 共通の識別情報・メタデータの正本。`$schema` で対象規格、`version` で Plugin のリリースバージョンを管理する。 |
| [skills/artifact-workflow/SKILL.md](skills/artifact-workflow/SKILL.md) | Agent Skills 形式の定義。`skills/` の直下から検出される。ワークフローと承認ルールの正本で、`compatibility` に実行環境の要件を記載する。 |
| `skills/artifact-workflow/references/` | Skill 固有のタスク分解・生成・セルフレビュー・検証・完成品の引き渡しとフロー終了の方針。 |
| [skills/artifact-workflow/assets/task-plan-template.md](skills/artifact-workflow/assets/task-plan-template.md) | Skill 固有の日本語のタスク計画テンプレート。 |
| [com.openai/agents/artifact-worker.toml](com.openai/agents/artifact-worker.toml) | Codex 固有の Custom Agent 定義。役割・生成とセルフレビューの指示・モデル・推論強度を管理する。 |
| [skills/artifact-workflow/agents/openai.yaml](skills/artifact-workflow/agents/openai.yaml) | Codex 互換用の表示情報と明示呼び出しの設定。共通規格の必須ファイルではない。 |
| [../../.codex/config.toml](../../.codex/config.toml) | このリポジトリで Custom Agent を登録する Codex 固有の参照設定。Plugin パッケージの外側にある。 |

MCP は同梱していません。追加する場合は Plugin root の `mcp.json` に、Agent Plugins の MCP schema と各サーバーの設定を記載します。

共通形式での検出・読み込みと、ワークフローを実行できることは区別します。現行の実行には Codex のマルチエージェント機能と登録済みの `artifact-worker` が必要です。他の compatible client へ移植する際は、その client での役割定義・委任方法を別途確認します。全 client での同一動作は保証対象に含めません。

### Codex 互換設定

[Agent Plugins の client extensions](https://agent-plugins.org/plugin-authors/client-extensions) に合わせ、Custom Agent の TOML は Plugin root の `com.openai/` 配下へ置きます。固有の manifest データが必要になった場合は `extensions.com.openai` を使います。

一方、Skill の `agents/openai.yaml` は、OpenAI 公式の [Optional metadata](https://learn.chatgpt.com/docs/build-skills#optional-metadata) に従う読み込み位置を維持します。表示情報と `allow_implicit_invocation: false` を保持するための、Agent Plugins の拡張ディレクトリ規約に対する互換性上の例外です。Agent Skills は Skill 内の追加ファイルを許容しますが、この YAML の設定と動作は Codex 固有であり、共通規格では定義されていません。

## 基本フロー

1. 依頼全体から今回の生成範囲を定め、成果物そのものを作成・変更する作業をタスクへ分解する。
2. 各タスクの目的・成果物・完了条件と、タスク外の品質確認・今回の全体の完了条件・完成品の提示と引き渡し情報を含む計画をユーザーへ提示する。
3. 原則としてユーザーの承認を得てから生成へ進む。
4. 親が承認済みの計画と依存関係から `artifact-worker` の担当を決め、成果物の生成を委任する。
5. 各担当の `artifact-worker` が生成した成果物そのものをセルフレビューし、必要な修正後に成果物とレビュー結果を親へ返す。
6. 親がタスクIDごとに成果物の実物を確認し、承認された完了条件を満たしたタスクを完了とする。
7. 今回の生成計画の全作業タスク完了後、親が成果物を今回の全体の完了条件と照合して、成果物完成を確認する。
8. 親が完成品と検証結果を提示するか、後続処理へ引き継いで生成フローを終了する。依頼された後続処理は、親が選択した手段の手順で続行する。

委任人数や並列実行、担当範囲の判断は[生成の方針](skills/artifact-workflow/references/generation.md)を参照してください。

`T1`、`T2` などのタスクIDは、計画から生成・セルフレビュー・検証まで同じタスクを追跡するために使います。検証で条件を満たさない場合は、親が同じタスクIDで `artifact-worker` に修正と必要なセルフレビューを依頼し、返された実物を再検証します。

### タスク分解で守る二つの境界

- **Task は成果物を作る作業単位**です。セルフレビュー、動作検証、完了条件の確認、全体検証はタスクを処理するフローとして実施し、独立した作業タスクにしません。
- **後続処理は本 Plugin の責務外**です。Delivery は完成品と必要な情報を提示・引き渡して生成フローを終える境界です。後続処理の実行・検証・成功条件は、今回の計画や完了判定に含めません。本 Plugin の委任・承認・検証ルールも、後続処理には適用しません。

デリバリー手段の例として Sites による公開があります。利用する手段は依頼に応じて選び、本 Plugin の必須依存にはしません。

後続処理の結果を使って別の成果物を作る場合は、その結果を得た後に別の生成として扱います。後で行う依頼と必要な入力は引き渡し情報に残し、今回の生成計画を結果待ちにしません。

本 Plugin の完了と、依頼全体の完了は別々に判断します。親は既存の指示と承認範囲を引き継いで後続の依頼を続行し、本 Plugin の完了だけで依頼全体を完了扱いにしません。詳細は[タスク分解の方針](skills/artifact-workflow/references/task-planning.md)と[引き渡しとフロー終了の方針](skills/artifact-workflow/references/delivery.md)を参照してください。

## Codex での使い方

Plugin のインストールにより、共通構造の `skills/` から Skill を検出できるようになります。ワークフローの実行には、次の Custom Agent の登録も必要です。このリポジトリでは [.codex/config.toml](../../.codex/config.toml) に登録済みで、別の作業場所では利用先に参照設定を追加してください。役割を利用できない場合、ワークフローは生成を開始せず登録に必要な対応を案内します。

登録後の新しいタスクで、作りたい成果物とともに `artifact-workflow` の利用を指定してください。提示されたタスク計画を確認し、承認またはタスクIDを指定した修正依頼を返します。

## Custom Agent の設定と登録

親には現在のチャットで選択したモデルをそのまま使用します。`artifact-worker` のモデル名と推論強度は [com.openai/agents/artifact-worker.toml](com.openai/agents/artifact-worker.toml) の `model` と `model_reasoning_effort` だけで管理し、差し替え時も Skill の変更は不要です。

Agent Plugins の共通コンポーネントは Skill と MCP で、Custom Agent の登録方法は定義されていません。同梱した TOML は Codex の設定 `agents.<name>.config_file` で参照します。`com.openai/agents/` は本リポジトリで固有ファイルを整理する配置であり、このディレクトリから Custom Agent が自動登録されるわけではありません。

このリポジトリでは [../../.codex/config.toml](../../.codex/config.toml) に参照を登録しています。別のプロジェクトで利用する場合は、そのプロジェクトの `.codex/config.toml`（個人共通なら `~/.codex/config.toml`）に以下を追加し、パスを同梱 TOML の実際の絶対パスへ置き換えてください。相対パスの場合は、この設定を記載する `config.toml` の場所が基準です。

```toml
[agents.artifact-worker]
config_file = "C:/path/to/matsu-artifact-delivery/plugins/artifact-workflow/com.openai/agents/artifact-worker.toml"
```

旧配置 `agents/artifact-worker.toml` を参照している場合は、上記の配置へ `config_file` を更新してください。

Plugin のインストールだけでは、この参照設定は追加されません。登録後は新しいタスクで利用してください。複数人で実行する場合も同じ `artifact-worker` の役割定義を使います。本フローのタスク分解・計画提示・承認・計画変更・タスクと全体の完了判定・完成品の提示と引き渡しは親が担当し、これらの工程そのものは委任しません。`artifact-worker` は承認済みの担当範囲内で生成・修正・セルフレビューを行います。

親が任意の相談を検討するときは、[任意の相談の方針](skills/artifact-workflow/references/escalation.md)に従い、現在のタスクで利用可能な Skill 一覧から相談 Skill の本文を読んで明示的に依頼します。`expert-escalation` は通常のモデル向け一覧へ公開する設定のため、本 Workflow だけを指定した新規タスクでも発見できます。発見のための Python や Codex CLI の追加起動は不要です。候補なし・無効・読み込み不能なら相談を見送り、通常フローへ戻ります。子ワーカーは親識別子を添えて相談依頼と再開情報を親へ返し、直接起動しません。自律相談の最大3回、相談用の実行枠、利用不能・上限到達時の継続判断は、本 Workflow の親が管理します。相談 Plugin 自体にはこの上限を持たせません。

相談役を生成ワーカーとは別に管理し、client の実行枠が共通なら相談用に1枠を予約します。既存の担当が全枠を使っている場合は、成果物と再開情報を回収し、枠の解放を確認してから交代します。相談不能や上限到達だけで全体を止めず、親が自力での継続・該当作業だけの停止・全体停止を判断します。特定の相談 Plugin やモデルを必須依存にせず、通常のセルフレビューと親の検証・完了判定を維持します。

設定方法は、OpenAI 公式の [Custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents) と [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference) を参照してください。
