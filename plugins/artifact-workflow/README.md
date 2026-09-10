# artifact-workflow

成果物の作成を、作業タスク計画へのユーザー承認からタスクと全体の検証、完成した成果物の引き渡し（Delivery）まで進める Plugin です。[Agent Plugins](https://agent-plugins.org/) の共通構造で Skill を配布し、Codex 向けに Custom Agent の定義を同梱しています。

コード、ドキュメント、PowerPoint、調査レポートなど、作るものと完了条件を合意してから作業したい場面で利用できます。特定の開発工程・言語・フレームワーク・成果物形式には依存せず、他の Plugin や Skill、外部サービスなしで単独利用できます。実行に必要な Codex 側の登録は後述します。

## 共通部分と Codex 固有部分

共通化できる内容は [Agent Plugins Specification](https://agent-plugins.org/specification) と [Agent Skills Specification](https://agentskills.io/specification) を優先します。今後の機能追加でも、共通規格で表現できる内容は共通側へ置き、client 固有の設定は分離します。

| 場所 | 区分と責務 |
| --- | --- |
| [plugin.json](plugin.json) | 共通の識別情報・メタデータの正本。`$schema` で対象規格、`version` で Plugin のリリースバージョンを管理する。 |
| [skills/artifact-workflow/SKILL.md](skills/artifact-workflow/SKILL.md) | Agent Skills 形式の定義。`skills/` の直下から検出される。ワークフローと承認ルールの正本で、`compatibility` に実行環境の要件を記載する。 |
| `skills/artifact-workflow/references/` | Skill 固有のタスク分解・生成・セルフレビュー・検証・Delivery の方針。 |
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

1. 成果物そのものを作成・変更する作業をタスクへ分解する。
2. 各タスクの目的・成果物・完了条件と、タスク外の品質確認・全体の完了条件・Delivery を含む計画をユーザーへ提示する。
3. 原則としてユーザーの承認を得てから生成へ進む。
4. 親が承認済みの計画と依存関係から `artifact-worker` の担当を決め、成果物の生成を委任する。
5. 各担当の `artifact-worker` が生成した成果物そのものをセルフレビューし、必要な修正後に成果物とレビュー結果を親へ返す。
6. 親がタスクIDごとに成果物の実物を確認し、承認された完了条件を満たしたタスクを完了とする。
7. 全作業タスク完了後、親が最終的な成果物を全体の完了条件と照合して、成果物完成を確認する。
8. 親が Delivery として完成した成果物を利用者へ提示し、依頼された公開・提出・PR 作成などがあれば担当 Skill・後続処理へ引き渡し、結果を伝える。

委任人数や並列実行、担当範囲の判断は[生成の方針](skills/artifact-workflow/references/generation.md)を参照してください。

`T1`、`T2` などのタスクIDは、計画から生成・セルフレビュー・検証まで同じタスクを追跡するために使います。検証で条件を満たさない場合は、親が同じタスクIDで `artifact-worker` に修正と必要なセルフレビューを依頼し、返された実物を再検証します。

### タスク分解で守る二つの境界

- **Task は成果物を作る作業単位**です。セルフレビュー、動作検証、完了条件の確認、全体検証はタスクを処理するフローとして実施し、独立した作業タスクにしません。
- **Delivery は作業タスクとは別のフェーズ**です。完成した成果物の提示と、依頼された公開・提出・PR 作成などへの引き渡しを管理します。後続操作の具体的な手順は担当 Skill に従い、その内部処理を作業タスクへ分解しません。

例えば「この Plugin でウェブサイトを作成し、その後 GitHub 操作 Skill で PR を作成」という依頼では、サイトの作成・修正をタスク化します。「レビュー」「公開」「PR 作成」を別タスクにせず、品質確認後に Delivery で完成した成果物を GitHub 操作 Skill へ渡します。Sites での公開も同様に扱います。

作業タスク完了・成果物完成・Delivery 完了は別々に判断します。外部 Skill への引き渡しが残る場合は成果物の検証結果と分けて伝え、依頼全体を完了扱いにしません。詳細は[タスク分解の方針](skills/artifact-workflow/references/task-planning.md)と[引き渡しの方針](skills/artifact-workflow/references/delivery.md)を参照してください。

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

Plugin のインストールだけでは、この参照設定は追加されません。登録後は新しいタスクで利用してください。複数人で実行する場合も同じ `artifact-worker` の役割定義を使います。タスク分解・計画提示・承認・計画変更・タスクと全体の完了判定・Delivery は親が担当し、これらの工程にはサブエージェントを追加しません。`artifact-worker` は承認済みの担当範囲内で生成・修正・セルフレビューを行います。

設定方法は、OpenAI 公式の [Custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents) と [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference) を参照してください。
