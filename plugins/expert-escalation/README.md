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

## 親・ワーカーからの利用

例えば「`$expert-escalation` で、この設計案が必須条件を満たせるか相談してください」と依頼します。Codex は `allow_implicit_invocation: true` で一覧へ公開しますが、開始は description と Skill 本文の明示依頼に限ります。一覧掲載・読み込みだけでは起動しません。[公式の呼び出し設定](https://learn.chatgpt.com/docs/build-skills#optional-metadata)も参照してください。

親は利用可能な実際の Skill パスを読み、契約に従って1件を起動します。相談役の役割、入力、返却項目は[相談役の契約](skills/expert-escalation/references/advisor-contract.md)、起動主体・実行枠・失敗時の扱いは[原理原則](skills/expert-escalation/references/principles.md)に記載しています。`artifact-workflow` の発見手順と呼び出し方針は[発見・起動](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/plugins/artifact-workflow/skills/artifact-workflow/references/escalation.md#発見起動)を参照してください。

## 共通規格と Codex 互換設定

[Agent Plugins Specification](https://agent-plugins.org/specification) と [Agent Skills Specification](https://agentskills.io/specification)を共通部分の基準にしています。

| 場所 | 扱い |
| --- | --- |
| [plugin.json](plugin.json) | 共通の識別情報・リリースバージョンの正本。`$schema` で対象規格を宣言する。 |
| `skills/expert-escalation/` | 共通の Skill 検出位置。手順・参照資料・テンプレートを同じ Skill 配下にまとめる。 |
| [.codex-plugin/plugin.json](.codex-plugin/plugin.json) | plugin-creator が生成する Codex 互換用 manifest。共通 manifest の識別情報に Codex の Skill 位置・表示情報を加える。Plugin の `interface.displayName` は Skill の `display_name` から生成する。 |
| [skills/expert-escalation/agents/openai.yaml](skills/expert-escalation/agents/openai.yaml) | Codex 向けの表示情報と `allow_implicit_invocation: true`。Plugin の表示名の正本とし、相談の開始条件は Skill の description と本文で管理する。 |

`.codex-plugin/plugin.json` と Skill の `agents/openai.yaml` は、Codex の既存の読み込み位置を維持する互換性上の例外です。共通規格のコンポーネントを増やす独自の検出方式ではなく、Codex 固有の設定として扱います。[Plugin パッケージ](https://developers.openai.com/plugins/build/plugins)と[Skill の optional metadata](https://learn.chatgpt.com/docs/build-skills#optional-metadata)を参照してください。manifest の共通フィールドは root を正本とし、変更時はリポジトリルートの `npm run sync:manifests` で互換 manifest を同期します。

Custom Agent、モデル選択、sandbox、同時起動枠の管理は Agent Plugins の共通仕様に含まれません。相談時のモデル・推論強度は最上位の親が実際の client/API で利用可能と確認した候補から選び、指定できない場合は client/親の既定へ戻します。他の client では同等の役割と親による明示呼び出しの経路を用意してください。

## Codex への登録

GitHub marketplace からインストールできます。Codex がリポジトリを取得します。

```sh
codex plugin marketplace add shu-matsukubo/matsu-artifact-delivery
codex plugin add expert-escalation@matsu-artifact-delivery
```

開発時のビルド・パッケージ検証は[配布と更新](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md)を参照してください。

Codex アプリでこのマーケットプレイスの `expert-escalation` をインストールし、新しいタスクを開始します。

Plugin を新しい版へ更新したら、marketplace を更新してインストール済みファイルを反映します。

```sh
codex plugin marketplace upgrade matsu-artifact-delivery
```

更新後は Codex を再起動し、新しいタスクを開始してください。起動時の設定エラーは[配布と更新](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md#更新後の起動確認)を参照してください。

## ライセンス

本 Plugin のソースコード・設定・ドキュメントは [MIT License](LICENSE) で公開しています。

Copyright (c) 2026 松久保 愁

再配布時は、著作権表示とライセンス本文を記載した同梱の `LICENSE` を含めてください。
