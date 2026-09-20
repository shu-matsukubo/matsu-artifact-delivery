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

合意済みの要求・制約・タスク計画をJSONで一時保持する `artifact-task-memory` MCP を同梱しています。[mcp.json](mcp.json) が共通設定、[mcp/src/](mcp/src/) がTypeScript実装、[mcp/task-memory.cjs](mcp/task-memory.cjs) が依存を同梱した実行ファイルです。公式 [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/) を使い、stdioで接続します。

共通形式での検出・読み込みと、ワークフローを実行できることは区別します。現行の実行には Codex のマルチエージェント機能と登録済みの `artifact-worker` が必要です。他の compatible client へ移植する際は、その client での役割定義・委任方法を別途確認します。全 client での同一動作は保証対象に含めません。

### 合意済み計画のMCP

実行にはPATH上の **Node.js 22.19以降**が必要です。配布物にSDKなどの依存を含めているため、利用時の `npm install` やビルドは不要です。クライアントが `mcp.json` を読み込み、`PLUGIN_ROOT` と書き込み可能な `PLUGIN_DATA` を提供してMCPを起動します。

動作確認済みのローカル環境は以下のとおりです。

| 項目 | 確認済み環境 |
| --- | --- |
| OS | Windows |
| Node.js | 22.23.2 |
| MCPクライアント | 公式 TypeScript SDK `@modelcontextprotocol/client` 2.0.0 によるstdioテストクライアント |

OSごとのMCP検証は下記のCIで行います。Codexへの実インストールを通した動作は未検証です。

- 新しい生成フローの開始時に `reset_session` で同じセッションの以前の内容をすべて初期化し、同じ保存先の完了記録済みセッションを削除する。未完了の別セッションは保持する。
- 合意後に `save_plan` で要求・要件・制約・タスク・完了条件・入力参照・引き渡し情報・承認根拠をJSONへ保存する。
- 以後は `get_plan` で保存済み計画を参照する。合意した計画の更新は、最新の版を指定して計画全体を書き戻す。
- 全タスク・全体検証・完成品の提示または引き渡しが終わったら、親が `complete_session` で完了を記録する。完了済み計画への通常の保存は拒否する。
- MCP再接続や会話の短縮では初期化しない。同じセッションIDと保存場所があれば、会話全体を再解釈せずに計画を読み戻せる。

4ツールすべてが、成功時の `structuredContent` の形式を `outputSchema` として公開します。`reset_session` は `{ session, cleanup }`、他の3ツールは `{ session }` を返し、`get_plan` のみ未初期化・削除済みの場合に `session: null` を返します。`cleanup` は削除件数 `deleted` と、見送ったファイル名・理由コードの配列 `skipped: [{ file, code }]` です。同じJSONをテキストでも返します。ツール実行エラーは `isError: true` とテキストで返し、成功時のスキーマの対象外とします。

保存先はリポジトリ外の `PLUGIN_DATA/task-memory/` です。セッションIDごとに1ファイルとし、履歴・DB・進捗の自動管理・別チャットからの復元機能は設けません。完了時は保存を残し、次の新しいフロー開始時に完了済みデータを削除します。削除はセッション単位のロック内で最新状態を確認して行い、ロック中・破損などで見送ったファイルは `cleanup.skipped` に理由を返します。完了記録のない旧形式や中断中のデータは保持します。後日の修正は、旧計画の有無によらず現在の成果物を確認し、新しい修正タスクの計画から始めます。詳細なJSON形式、初期化の境界、競合時の扱いは[タスク計画の一時保持](skills/artifact-workflow/references/task-memory.md)を参照してください。

開発時はPlugin rootで以下を実行します。GitHub Actionsでも同じ検証を行います。

```sh
npm ci
npm run check
npm run lint
npm run format:check
npm test
```

- `npm run check` はTypeScriptの型検査です。
- `npm run lint` はOxlintの型情報を使い、未処理Promise・Promiseの誤用・未使用コードなどを検査します。TypeScript 7に対応する `oxlint-tsgolint` を併用します。
- `npm run format:check` はPrettierでMCPソース・テスト・ビルドスクリプト・開発設定・CI設定の書式を検査します。`npm run format` で整形できます。
- `npm test` は最初に `npm run check:dist` で配布物と再生成結果の完全一致を確認します。配布物の更新・欠落があれば失敗し、既存ファイルを上書きしません。その後、`.test-build` を削除し、現在のソースだけをコンパイルしてテストします。
- ソースや正本設定を変更したら `npm run build` で配布物を更新してください。型検査に成功してから、MCP実行ファイル・ライセンス通知・[依存ライセンス](mcp/THIRD_PARTY_LICENSES.txt)・Codex互換設定を生成します。生成ファイルも変更と一緒にコミットし、直接編集しないでください。

[GitHub ActionsのCI](../../.github/workflows/artifact-workflow-ci.yml)はPR・`main` へのpush・手動実行を対象に、Windows・Linux・macOS × Node.js 22.19.0・24で検証します。ビルドによって更新漏れを隠さないよう、チェックアウトした配布物をそのまま検証・起動します。

テストではOSの一時ディレクトリを使い、セッションの分離、更新競合、不正データの拒否、完了済みデータの削除、未完了・旧形式の保護、後日の修正タスク、実MCP通信、Node.jsだけでの起動と再接続後の読み戻しを確認します。1 MiBの上限は完了日時の増加分を含めて保存時に判定し、上限ちょうどの完了済みデータと1 byte超過の拒否を検証します。書き込み・`sync`・`rename` にI/Oエラーを注入するテストでは、旧データの保持、一時ファイルとロックの解放、再試行の成功を確認します。型エラーによる配布ビルドの停止と配布物の保持、配布物5種類の欠落・改変、ソースだけを変更した際の更新漏れ、削除済みテストのコンパイル残骸の掃除も隔離環境で検証します。

### Codex 互換設定

共通形式の `plugin.json` と `mcp.json` を正本とし、`plugin-creator` の検証と旧形式の読み込みに対応するため `.codex-plugin/plugin.json` と `.mcp.json` をビルド時に生成します。現行のポータブル形式ではルートの共通設定が優先されます。これは[OpenAI公式のパッケージ仕様](https://developers.openai.com/plugins/build/plugins)に基づく互換設定で、マーケットプレイスの別エントリや別サーバーは追加しません。

[Agent Plugins の client extensions](https://agent-plugins.org/plugin-authors/client-extensions) に合わせ、Custom Agent の TOML は Plugin root の `com.openai/` 配下へ置きます。固有の manifest データが必要になった場合は `extensions.com.openai` を使います。

一方、Skill の `agents/openai.yaml` は、OpenAI 公式の [Optional metadata](https://learn.chatgpt.com/docs/build-skills#optional-metadata) に従う読み込み位置を維持します。表示情報と `allow_implicit_invocation: false` を保持するための、Agent Plugins の拡張ディレクトリ規約に対する互換性上の例外です。Agent Skills は Skill 内の追加ファイルを許容しますが、この YAML の設定と動作は Codex 固有であり、共通規格では定義されていません。

## 基本フロー

1. 新しい生成フローの開始時に親のセッションの保持内容を初期化し、同じ保存先の完了記録済みセッションを削除する。依頼全体から今回の生成範囲を定め、成果物そのものを作成・変更する作業をタスクへ分解する。
2. 各タスクの目的・成果物・完了条件と、タスク外の品質確認・今回の全体の完了条件・完成品の提示と引き渡し情報を含む計画をユーザーへ提示する。
3. 原則としてユーザーの承認を得て、合意済み計画をMCPへ保存してから生成へ進む。
4. 親がMCPから取得した承認済みの計画と依存関係から `artifact-worker` の担当を決め、成果物の生成を委任する。
5. 各担当の `artifact-worker` が生成した成果物そのものをセルフレビューし、必要な修正後に成果物とレビュー結果を親へ返す。
6. 親がタスクIDごとに成果物の実物を確認し、承認された完了条件を満たしたタスクを完了とする。
7. 今回の生成計画の全作業タスク完了後、親が成果物を今回の全体の完了条件と照合して、成果物完成を確認する。
8. 親が完成品と検証結果を提示するか、後続処理へ必要な情報を引き継ぎ、`complete_session` で完了を記録して生成フローを終了する。依頼された後続処理は、親が選択した手段の手順で続行する。

委任人数や並列実行、担当範囲の判断は[生成の方針](skills/artifact-workflow/references/generation.md)を参照してください。

`T1`、`T2` などのタスクIDは、計画から生成・セルフレビュー・検証まで同じタスクを追跡するために使います。検証で条件を満たさない場合は、親が同じタスクIDで `artifact-worker` に修正と必要なセルフレビューを依頼し、返された実物を再検証します。

### セルフレビューの共通原則

セルフレビューは、[成果物レビューの原理原則](skills/artifact-workflow/references/review-principles.md)に沿って作成者が実物を短く確認し、問題を修正する工程です。原則の定義を共通資料にまとめ、長いチェック表の記入は求めません。親による完了条件の検証は別に行います。

将来レビュー専用エージェントを追加する際は、同じ原則と別資料の固有観点を組み合わせて確認する構成とします。現在のセルフレビューには共通原則を適用します。確認・修正・返却の手順と将来の責務分担は[セルフレビューの方針](skills/artifact-workflow/references/self-review.md)を参照してください。

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

## ライセンス

本 Plugin のソースコード・設定・ドキュメントは [MIT License](LICENSE) で公開しています。

Copyright (c) 2026 松久保 愁

再配布時は、著作権表示とライセンス本文を記載した同梱の `LICENSE` を含めてください。
