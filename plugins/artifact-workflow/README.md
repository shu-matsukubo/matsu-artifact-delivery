# artifact-workflow

成果物を作る作業を計画し、承認後に生成・セルフレビュー・独立レビュー・検証を行う Plugin です。完成品と検証結果を提示し、必要な引き渡し情報を親へ返します。

`artifact-workflow` は標準 subagent を使い、worker と reviewer の役割指示を Plugin 内の Skill にまとめています。対応環境は Windows x64 です。

## インストール

```sh
codex plugin marketplace add shu-matsukubo/matsu-artifact-delivery
codex plugin add artifact-workflow@matsu-artifact-delivery
```

Plugin をインストールし、新しいタスクで `artifact-workflow` の利用を指定してください。親が計画を提示し、承認後に作業を進めます。

更新する場合は、marketplace を更新してインストール済みファイルを反映します。

```sh
codex plugin marketplace upgrade matsu-artifact-delivery
```

更新後は Codex を再起動し、新しいタスクを開始してください。起動時の設定エラーは[配布と更新](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md#更新後の起動確認)を参照してください。

## Workflow の構成

| 場所                                                                                                               | 責務                                             |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| [SKILL.md](skills/artifact-workflow/SKILL.md)                                                                      | 計画、承認、生成、レビュー、検証、引き渡しの正本 |
| [task-plan-template.md](skills/artifact-workflow/assets/task-plan-template.md)                                     | ユーザーに提示するタスク計画                     |
| [subagent-roles.md](skills/artifact-workflow/assets/subagent-roles.md)                                             | worker / reviewer の役割指示                     |
| [mcp.json](mcp.json)                                                                                               | `artifact-task-memory` MCP の起動設定            |
| [extension-management](skills/extension-management/SKILL.md)                                                       | 再利用する生成・レビュー指示の登録と管理         |
| [MCP source](https://github.com/shu-matsukubo/matsu-artifact-delivery/tree/main/plugins/artifact-workflow/mcp/src) | MCP の保守用 TypeScript 実装                     |

生成とセルフレビューには標準 subagent を使い、独立レビューには生成担当とは別の標準 subagent を使います。各役割の指示は Plugin 内の `subagent-roles.md` にまとめます。subagent は親のモデル、推論設定、利用可能なツールを継承するため、親がタスク全体に適した設定を選びます。reviewer にはプロンプトで読み取り専用の振る舞いを求めますが、これは実行環境の権限を変更しません。親が全 subagent の実行を管理します。

MCP の依存 bundle、Windows x64 Node.js runtime、初回起動時に runtime をユーザーデータ領域へ展開するランチャーを同梱します。計画データは `PLUGIN_DATA/task-memory/`、登録拡張は計画回収から独立した `PLUGIN_DATA/extensions/` に保存されます。`PLUGIN_DATA` がない場合、拡張は OS のユーザー状態ディレクトリへ永続保存されます。

他の compatible client への移植では、その client の subagent 委任方法を別途確認してください。全 client で同一の委任動作は保証しません。

## 拡張指示の登録

「今後のTypeScript生成用に、この手順を指示として登録して」のように、登録意図を自然言語で明示して頼みます。`extension-management` Skill が生成・レビュー指示の登録管理を扱います。登録前に既存の指示を調べ、内容を `generation` / `review`、対象、適用条件、概要、実行指示、任意の依存先へ整理します。要求にないコマンドや品質基準は追加しません。

「登録済みの生成指示を一覧して」「ID `csv-report` の内容を見せて」「この指示の概要を変更して」「この名前の指示を削除して」のような管理依頼も行えます。名前が重複して対象を特定できない場合は ID を確認します。登録指示が0件、またはタスクに適合する指示がない場合は、共通 Workflow の指示で続行します。登録データは計画セッションから独立して保持されます。MCP は指示を保存・検索・取得するだけで、依存 Skill やコマンドを登録時に実行しません。

## 開発と配布

MCP の型検査・試験・配布物の生成方法は[配布と更新](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md)を参照してください。共通基盤に影響する変更ではルートの品質チェックと試験も実行します。

## ライセンス

本 Plugin のソースコード・設定・ドキュメントは [MIT License](LICENSE) で公開しています。再配布時は同梱の `LICENSE` と `mcp/NODE_RUNTIME_LICENSES.txt`、`mcp/THIRD_PARTY_LICENSES.txt` を含めてください。
