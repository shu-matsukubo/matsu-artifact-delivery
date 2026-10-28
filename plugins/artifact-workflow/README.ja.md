[English](README.md) | 日本語

# artifact-workflow

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshu-matsukubo%2Fmatsu-artifact-delivery%2Fmain%2Fplugins%2Fartifact-workflow%2Fplugin.json&query=%24.version&label=version)](plugin.json)
![Status: Development](https://img.shields.io/badge/status-development-yellow.svg)
[![MCP: Windows x64 only](https://img.shields.io/badge/MCP-Windows%20x64%20only-lightgrey.svg)](#mcp-runtime)

成果物の範囲を計画して承認を得た後、成果物の生成、独立レビュー、完了条件の検証を調停する Plugin です。完成品と検証結果を提示し、必要な引き渡し情報を親へ返します。

## インストール

```sh
codex plugin marketplace add shu-matsukubo/matsu-artifact-delivery
codex plugin add artifact-workflow@matsu-artifact-delivery
```

インストール後に新しいタスクを開始し、依頼を入力する前に Codex の `$` メニューまたは Skill セレクターから「成果物生成ワークフロー」を選択してください。たとえば「新入社員向けの案内文を Markdown で1ページ作成してください」と依頼します。依頼文に `artifact-workflow` や `$artifact-workflow` と書くことと、メニューで Skill を選択することは別の操作です。

CLI / IDE では `/skills` または `$` から選択できます。App Server では `skills/list` が返す正式な `name` と `path` を、`turn/start` の `skill` input に指定します。詳細は[App Server の再現手順](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/model-acceptance.md#app-server-を使う再現手順)を参照してください。

通常の作成依頼は計画への承認として扱いません。親が計画を提示し、同じ計画への明示的な承認を得た後に作業を進めます。実行順序はクライアントの上位指示や機能にも依存するため、承認待ちを制御できない環境では保証されません。承認待ちを求める場合は、たとえば「成果物を作成してください。まず計画を提示し、私の承認を得るまで計画の保存・委任・生成を開始しないでください」と依頼に加えられます。これはクライアントの上位指示や機能を上書きするものではありません。インストール済みファイルを更新するには marketplace を更新します。

```sh
codex plugin marketplace upgrade matsu-artifact-delivery
```

更新後は Codex を再起動し、新しいタスクを開始してください。起動時の設定エラーは[配布と更新](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md#更新後の起動確認)を参照してください。

## Workflow の構成

| 場所                                                                                                               | 責務                                    |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| [artifact-workflow](skills/artifact-workflow/SKILL.md)                                                             | 工程調停、承認、検証、引き渡し          |
| [task-planning](skills/task-planning/SKILL.md)                                                                     | 範囲、タスク分解、計画提示              |
| [artifact-generation](skills/artifact-generation/SKILL.md)                                                         | 生成原則、worker 委任、作成・修正・返却 |
| [artifact-review](skills/artifact-review/SKILL.md)                                                                 | 独立レビュー、指摘、再レビュー          |
| [task-plan-template.md](skills/task-planning/assets/task-plan-template.md)                                         | ユーザーに提示する計画                  |
| [worker.md](skills/artifact-generation/assets/worker.md)                                                           | 成果物 worker への指示                  |
| [reviewer.md](skills/artifact-review/assets/reviewer.md)                                                           | 独立 reviewer への指示                  |
| [mcp.json](mcp.json)                                                                                               | `artifact-task-memory` MCP の起動設定   |
| [extension-management](skills/extension-management/SKILL.md)                                                       | 再利用する成果物向けガイダンスの管理    |
| [MCP source](https://github.com/shu-matsukubo/matsu-artifact-delivery/tree/main/plugins/artifact-workflow/mcp/src) | MCP 保守用 TypeScript 実装              |

親が subagent を管理し、タスクごとのモデル・推論設定を選びます。reviewer には読み取り専用を指示しますが、実行時の権限は変更されません。[reviewer の手順](skills/artifact-review/SKILL.md)を参照してください。

## MCP runtime

MCP の依存 bundle、Windows x64 向け Node.js runtime、初回起動時に runtime をユーザーデータ領域へ展開するランチャーを同梱します。同梱 MCP runtime の対応環境は Windows x64 です。Plugin の Skill は他の compatible client でも利用できますが、subagent の委任方法を別途確認してください。全 client で同じ委任動作は保証しません。

計画データは `PLUGIN_DATA/task-memory/`、登録拡張は独立した `PLUGIN_DATA/extensions/` に保存されます。`PLUGIN_DATA` がない場合、拡張は OS のユーザー状態ディレクトリへ永続保存されます。

## 共通ガイダンスの登録

「今後の React 画面実装にこの方針を適用して」のように、登録や今後にも適用する意向を明確に伝えます。`extension-management` Skill は成果物単位の共通方針を管理します。対象、適用条件、概要、実装指示、関連する lint・型検査・実行コマンド、注意をまとめ、生成と独立レビューの両方で使います。既存の候補を調べ、提案との差分に明示的な同意を得てから保存します。依頼にないコマンドや品質基準は追加しません。

登録済み方針の一覧、ID による表示、概要の編集、名前による削除も依頼できます。名前が重複する場合は ID で対象を特定してください。関連する方針がなければ依頼内容と共通原則で続行します。MCP は方針の保存・検索・取得だけを行い、Skill やコマンドを実行しません。会話から方針を提案する場合、client が `extension-management` を選んで実行する必要があります。全会話を自動監視する機能ではありません。Workflow 完了時の提案は[delivery の手順](skills/artifact-workflow/references/delivery.md)に記載しています。

## 開発と配布

MCP の型検査・試験・配布物の生成方法は[配布と更新](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md)を参照してください。共通基盤に影響する変更ではリポジトリの品質チェックと試験も実行します。

## ライセンス

本 Plugin のソースコード・設定・ドキュメントは [MIT License](LICENSE) で公開しています。再配布時は同梱の `LICENSE`、`mcp/NODE_RUNTIME_LICENSES.txt`、`mcp/THIRD_PARTY_LICENSES.txt` を含めてください。
