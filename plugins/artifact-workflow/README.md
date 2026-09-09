# artifact-workflow

成果物の作成を、タスク計画へのユーザー承認から完了条件の検証まで進める、Skill と Custom Agent の定義を含む Codex Plugin です。

コード、ドキュメント、PowerPoint、調査レポートなど、作るものと完了条件を合意してから作業したい場面で利用できます。特定の開発工程・言語・フレームワーク・成果物形式には依存せず、他の Plugin や Skill、外部サービスなしで単独利用できます。

## 基本フロー

1. 必要な作業をタスクへ分解する。
2. 目的・成果物・完了条件を含むタスク計画をユーザーへ提示する。
3. 原則としてユーザーの承認を得てから生成へ進む。
4. 親が承認済みの計画と依存関係から1〜3人の `artifact-worker` の担当を決め、成果物の生成を委任する。
5. 各担当の `artifact-worker` が生成した成果物そのものをセルフレビューし、必要な修正後に成果物とレビュー結果を親へ返す。
6. 親がタスクIDごとに成果物の実物を確認し、承認された完了条件と比較して検証する。
7. 親がすべての完了条件を満たした成果物をユーザーへ提示する。

v0.2.0では、生成・修正とそれに伴うセルフレビューに最低1人、同時に最大3人の `artifact-worker` を使います。独立したタスクは並列実行でき、依存関係がある場合や効果が小さい場合は1人で進めます。親が承認済みの計画から人数と担当範囲を判断し、編集が競合する作業や必要な統合作業は順次委任します。詳しくは[生成の方針](skills/artifact-workflow/references/generation.md)を参照してください。

`T1`、`T2` などのタスクIDは、計画から生成・セルフレビュー・検証まで同じタスクを追跡するために使います。検証で条件を満たさない場合は、親が同じタスクIDで `artifact-worker` に修正と必要なセルフレビューを依頼し、返された実物を再検証します。

## 使い方

インストール後の新しいタスクで、作りたい成果物とともに `artifact-workflow` の利用を指定してください。提示されたタスク計画を確認し、承認またはタスクIDを指定した修正依頼を返します。

利用先で、次の Custom Agent の登録も必要です。役割を利用できない場合、ワークフローは生成を開始せず登録に必要な対応を案内します。

## Custom Agent の設定と登録

親には現在のチャットで選択したモデルをそのまま使用します。`artifact-worker` のモデル名と推論強度は [agents/artifact-worker.toml](agents/artifact-worker.toml) の `model` と `model_reasoning_effort` だけで管理し、差し替え時も Skill の変更は不要です。

Plugin Creator の現行 manifest 仕様には Custom Agent の登録項目がないため、同梱した TOML を Codex の公式設定 `agents.<name>.config_file` で参照します。このリポジトリでは [../../.codex/config.toml](../../.codex/config.toml) に参照を登録しています。

別のプロジェクトで利用する場合は、そのプロジェクトの `.codex/config.toml`（個人共通なら `~/.codex/config.toml`）に以下を追加し、パスを同梱 TOML の実際の絶対パスへ置き換えてください。相対パスの場合は、この設定を記載する `config.toml` の場所が基準です。

```toml
[agents.artifact-worker]
config_file = "C:/path/to/matsu-artifact-delivery/plugins/artifact-workflow/agents/artifact-worker.toml"
```

Plugin のインストールだけでは、この参照設定は追加されません。登録後は新しいタスクで利用してください。複数人で実行する場合も同じ `artifact-worker` の役割定義を使います。タスク分解・計画提示・承認・計画変更・最終的な完了判定・ユーザーへの提出は親が担当し、これらの工程にはサブエージェントを追加しません。`artifact-worker` は承認済みの担当範囲内で生成・修正・セルフレビューを行います。

配置と設定は、OpenAI 公式の [Custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents) と [Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference) に基づきます。

## 構成

| 場所 | 責務 |
| --- | --- |
| [plugin.json](plugin.json) | Plugin の識別情報、バージョン、日本語の利用者向け説明。Skill は `skills/` から検出される。 |
| [agents/artifact-worker.toml](agents/artifact-worker.toml) | Custom Agent の役割・生成とセルフレビューの指示・モデル固有設定。 |
| [../../.codex/config.toml](../../.codex/config.toml) | このリポジトリで Custom Agent を登録する参照設定。 |
| [skills/artifact-workflow/SKILL.md](skills/artifact-workflow/SKILL.md) | ワークフローと承認ルールの正本。 |
| `skills/artifact-workflow/references/` | タスク分解・生成・セルフレビュー・検証の工程別の方針。 |
| [skills/artifact-workflow/assets/task-plan-template.md](skills/artifact-workflow/assets/task-plan-template.md) | ユーザーへ提示する日本語のタスク計画テンプレート。 |
