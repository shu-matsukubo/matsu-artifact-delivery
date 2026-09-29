# artifact-workflow

成果物を作る作業を計画し、承認後に生成・セルフレビュー・独立レビュー・検証を行う Plugin です。完成品と検証結果を提示し、必要な引き渡し情報を親へ返します。

`artifact-reviewer` Custom Agent を登録してから、`artifact-workflow` の利用を指定できます。生成担当は役割テンプレートを使い、独立レビュー担当は読み取り専用 sandbox を強制する Agent を使います。このリポジトリでは `.codex/config.toml` に登録済みです。他の作業環境では、同梱の `com.openai/agents/artifact-reviewer.toml` を以下の手順で登録してください。Node.js の事前導入は不要です。初期対応環境は Windows x64 です。

## インストール

```sh
codex plugin marketplace add shu-matsukubo/matsu-artifact-delivery
codex plugin add artifact-workflow@matsu-artifact-delivery
```

### Reviewer Agent の登録

Plugin のインストールだけでは Custom Agent は登録されません。インストール後、`<CODEX_HOME>/plugins/cache/matsu-artifact-delivery/artifact-workflow/` にあるインストール済みバージョンを確認し、プロジェクトの `.codex/config.toml` または個人設定の `<CODEX_HOME>/config.toml` に次を追加します。`<CODEX_HOME>` と `<installed-version>` は実際のパスに置き換えてください。

```toml
[agents.artifact-reviewer]
config_file = "C:/Users/<username>/.codex/plugins/cache/matsu-artifact-delivery/artifact-workflow/<installed-version>/com.openai/agents/artifact-reviewer.toml"
```

設定後に Codex を再起動し、新しいタスクで `artifact-workflow` の利用を指定してください。親が計画を提示し、承認後に作業を進めます。

Plugin を更新したときは marketplace を更新してインストール済みファイルを反映し、設定のバージョンパスも新しいディレクトリへ変更します。

```sh
codex plugin marketplace upgrade matsu-artifact-delivery
```

パスを更新してから Codex を再起動してください。古いバージョンのパスを残すと Agent 定義を読み込めません。

## Workflow の構成

| 場所 | 責務 |
| --- | --- |
| [SKILL.md](skills/artifact-workflow/SKILL.md) | 計画、承認、生成、レビュー、検証、引き渡しの正本 |
| [task-plan-template.md](skills/artifact-workflow/assets/task-plan-template.md) | ユーザーに提示するタスク計画 |
| [subagent-roles.md](skills/artifact-workflow/assets/subagent-roles.md) | worker / reviewer の指示、モデル、推論強度 |
| [artifact-reviewer.toml](com.openai/agents/artifact-reviewer.toml) | `read-only` sandbox と承認要求なしを強制する Codex reviewer 設定 |
| [mcp.json](mcp.json) | `artifact-task-memory` MCP の起動設定 |
| [MCP source](https://github.com/shu-matsukubo/matsu-artifact-delivery/tree/main/plugins/artifact-workflow/mcp/src) | MCP の保守用 TypeScript 実装 |

生成とセルフレビューには標準 subagent を使い、独立レビューには別の読み取り専用 `artifact-reviewer` を使います。役割と推奨モデル設定は Plugin 内の `subagent-roles.md` にまとめ、Custom Agent 設定は読み取り専用権限を適用します。親が全 subagent の実行を管理します。

MCP の依存 bundle、Windows x64 Node.js runtime、初回起動時に runtime をユーザーデータ領域へ展開するランチャーを同梱します。ネットワーク接続、npm、利用者によるビルドは不要です。計画データは Plugin の外にある `PLUGIN_DATA/task-memory/` に保存されます。

他の compatible client への移植では、その client の subagent 委任方法を別途確認してください。全 client で同一の委任動作は保証しません。

## 開発と配布

MCP の型検査・試験・配布物の生成方法は[配布と更新](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md)を参照してください。共通基盤に影響する変更ではルートの品質チェックと試験も実行します。

## ライセンス

本 Plugin のソースコード・設定・ドキュメントは [MIT License](LICENSE) で公開しています。再配布時は同梱の `LICENSE` と `mcp/NODE_RUNTIME_LICENSES.txt`、`mcp/THIRD_PARTY_LICENSES.txt` を含めてください。
