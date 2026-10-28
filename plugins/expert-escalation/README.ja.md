[English](README.md) | 日本語

# expert-escalation

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fshu-matsukubo%2Fmatsu-artifact-delivery%2Fmain%2Fplugins%2Fexpert-escalation%2Fplugin.json&query=%24.version&label=version)](plugin.json)
![Status: Development](https://img.shields.io/badge/status-development-yellow.svg)

設計・セキュリティ・変更影響など、明示依頼された論点を読み取り専用の相談役へ渡す独立した Plugin です。元の担当が実装と検証を続けます。累計の回数制限は設けず、上限・再試行・作業を続けるか止めるかは呼び出し元の親が管理します。

## 内容

| 内容                           | 正本                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| 呼び出し手順と基本的な境界     | [SKILL.md](skills/expert-escalation/SKILL.md)                                                  |
| 相談する論点の例               | [triggers.md](skills/expert-escalation/references/triggers.md)                                 |
| 原則と呼び出し元の責務         | [principles.md](skills/expert-escalation/references/principles.md)                             |
| 相談役の役割・入力・返却項目   | [advisor-contract.md](skills/expert-escalation/references/advisor-contract.md)                 |
| 相談結果と親の判断テンプレート | [escalation-result-template.md](skills/expert-escalation/assets/escalation-result-template.md) |

## 親・ワーカーからの利用

たとえば「`$expert-escalation` で、この設計案が必須条件を満たすか確認してください」と依頼します。ユーザーまたは呼び出し元の親が明示的に依頼した場合だけ起動します。Codex では `allow_implicit_invocation: true` により Skill 一覧へ表示しますが、Skill の description と本文は明示依頼を起動条件とします。一覧掲載や読み込みだけでは相談を開始しません。[公式の呼び出し設定](https://learn.chatgpt.com/docs/build-skills#optional-metadata)を参照してください。

親はインストール済み Skill を読み、その契約に従って相談役を1件起動します。[相談役の契約](skills/expert-escalation/references/advisor-contract.md)に役割・入力・返却項目、[原則](skills/expert-escalation/references/principles.md)に呼び出し元の責務と相談不能時の扱いを記載しています。`artifact-workflow` での発見と呼び出し方針は[こちら](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/plugins/artifact-workflow/skills/artifact-workflow/references/escalation.md#発見起動)を参照してください。

## 共通規格と Codex 互換設定

共通形式の基準は [Agent Plugins Specification](https://agent-plugins.org/specification) と [Agent Skills Specification](https://agentskills.io/specification)です。

| 場所                                                                                       | 扱い                                                                                                                  |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [plugin.json](plugin.json)                                                                 | 共通メタデータとリリースバージョンの正本。対象 schema を宣言します。                                                  |
| `skills/expert-escalation/`                                                                | 手順と参照資料を置く共通 Skill の位置です。                                                                           |
| [.codex-plugin/plugin.json](.codex-plugin/plugin.json)                                     | Skill の位置と表示情報を加えた Codex 互換 manifest の生成物です。                                                     |
| [skills/expert-escalation/agents/openai.yaml](skills/expert-escalation/agents/openai.yaml) | Codex の表示情報と `allow_implicit_invocation: true` を設定します。起動条件は Skill の description と本文で定めます。 |

`.codex-plugin/plugin.json` と `agents/openai.yaml` は、Codex の既存の読み込み位置を維持するための Codex 固有の互換設定です。共通規格に独自の検出方式を加えるものではありません。[Plugin packaging](https://developers.openai.com/plugins/build/plugins)と[Skill の optional metadata](https://learn.chatgpt.com/docs/build-skills#optional-metadata)を参照してください。共通フィールドの正本はルートの `plugin.json` です。変更後はリポジトリルートで `npm run sync:manifests` を実行して互換 manifest を同期します。

Custom Agent、モデル選択、sandbox、同時起動枠は Agent Plugins の共通仕様の対象外です。最上位の親が利用中の client/API で使えるモデルと推論設定を選び、利用できない場合は client または親の既定値を使います。他の client では同等の相談役と明示依頼の経路を用意してください。

## Codex へのインストールと更新

GitHub marketplace を追加すると Codex がリポジトリを取得します。

```sh
codex plugin marketplace add shu-matsukubo/matsu-artifact-delivery
codex plugin add expert-escalation@matsu-artifact-delivery
```

Codex アプリで marketplace の Plugin をインストールし、新しいタスクを開始してください。開発ビルドとパッケージ検証は[配布と更新](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md)を参照してください。

インストール済みファイルを更新するには marketplace を更新します。

```sh
codex plugin marketplace upgrade matsu-artifact-delivery
```

更新後は Codex を再起動し、新しいタスクを開始してください。起動時の設定エラーは[配布と更新](https://github.com/shu-matsukubo/matsu-artifact-delivery/blob/main/docs/distribution.md#更新後の起動確認)を参照してください。

## ライセンス

本 Plugin のソースコード・設定・ドキュメントは [MIT License](LICENSE) で提供します。再配布時は著作権表示とライセンス本文が記載された同梱の `LICENSE` を含めてください。
