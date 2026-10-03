# artifact-workflow

成果物を作る作業を計画し、承認後に生成・セルフレビュー・独立レビュー・検証を行う Plugin です。完成品と検証結果を提示し、必要な引き渡し情報を親へ返します。

`artifact-workflow` は標準 subagent を使い、worker と reviewer の役割指示を Plugin 内の Skill にまとめています。利用者による `.codex` 配下への設定ファイル配置は不要です。Node.js の事前導入は不要です。初期対応環境は Windows x64 です。

## インストール

```sh
codex plugin marketplace add shu-matsukubo/matsu-artifact-delivery
codex plugin add artifact-workflow@matsu-artifact-delivery
```

Plugin をインストールし、新しいタスクで `artifact-workflow` の利用を指定してください。親が計画を提示し、承認後に作業を進めます。

旧版で `[agents.artifact-reviewer]` を登録していた場合は、`config_file` を含む設定ブロックを利用先の Codex 設定から削除してください。

```sh
codex plugin marketplace upgrade matsu-artifact-delivery
```

パスを更新してから Codex を再起動してください。古いバージョンのパスを残すと Agent 定義を読み込めません。

## Workflow の構成

| 場所 | 責務 |
| --- | --- |
| [SKILL.md](skills/artifact-workflow/SKILL.md) | 計画、承認、生成、レビュー、検証、引き渡しの正本 |
| [task-plan-template.md](skills/artifact-workflow/assets/task-plan-template.md) | ユーザーに提示するタスク計画 |
| [subagent-roles.md](skills/artifact-workflow/assets/subagent-roles.md) | worker / reviewer の指示、推奨モデル、推論強度 |
| [mcp.json](mcp.json) | `artifact-task-memory` MCP の起動設定 |
| [MCP source](https://github.com/shu-matsukubo/matsu-artifact-delivery/tree/main/plugins/artifact-workflow/mcp/src) | MCP の保守用 TypeScript 実装 |

生成とセルフレビューには標準 subagent を使い、独立レビューには生成担当とは別の標準 subagent を使います。各役割の指示と推奨モデル設定は Plugin 内の `subagent-roles.md` にまとめます。reviewer にはプロンプトで読み取り専用の振る舞いを求めますが、Custom Agent の設定による強制ではありません。親が全 subagent の実行を管理します。

MCP の依存 bundle、Windows x64 Node.js runtime、初回起動時に runtime をユーザーデータ領域へ展開するランチャーを同梱します。ネットワーク接続、npm、利用者によるビルドは不要です。計画データは Plugin の外にある `PLUGIN_DATA/task-memory/` に保存されます。

他の compatible client への移植では、その client の subagent 委任方法を別途確認してください。全 client で同一の委任動作は保証しません。

## 開発と配布

MCP の型検査・試験・配布物の生成方法は[配布と更新](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md)を参照してください。共通基盤に影響する変更ではルートの品質チェックと試験も実行します。

## ライセンス

本 Plugin のソースコード・設定・ドキュメントは [MIT License](LICENSE) で公開しています。再配布時は同梱の `LICENSE` と `mcp/NODE_RUNTIME_LICENSES.txt`、`mcp/THIRD_PARTY_LICENSES.txt` を含めてください。
