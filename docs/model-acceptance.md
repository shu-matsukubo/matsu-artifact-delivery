# 実モデル受け入れ手順

随時の実モデル試験は任意とし、モデル課金があるため通常 CI では実行しない。一方、正式リリース前には候補を固定し、[配布手順](distribution.md#正式版の確定)に定める生成・承認待ち・独立レビュー・相談を含む実モデル受け入れを完了する。契約・構成・参照グラフの回帰は再現可能な自動試験で確認する。

## 実行条件

- 対象 client と Plugin 版を固定し、試験専用タスク・一時ホーム・試験専用成果物を使う。実ユーザーの設定、cache、保存済み計画は変更しない。
- MCP の保存先も確認する。対象版の `${PLUGIN_DATA}/task-memory` が隔離 home 配下に展開されていることを確かめ、通常利用の保存先を共有しない。
- 既存の認証を使う場合は隔離ホームに必要な認証だけを用意する。token、認証ファイル、私的内容、モデルの非公開推論を出力・保存・結果記録に含めない。
- 本試験前に client が報告する model、reasoning effort、approval policy、reviewer、active permission profile を記録する。短い事前検証 turn で試験用ディレクトリの読み書きと必要なツール可用性を実測し、意図した条件と異なる場合は本試験の turn を開始しない。
- `skills/list` を使う client では対象作業ディレクトリと `forceReload` を指定し、名前・path・有効状態を確認する。この応答と `plugin/install` の応答は導入 Plugin version の証拠にしない。thread を開始する前に、各導入先の実 cache にある `.codex-plugin/plugin.json` などの version を持つ manifest を読み、固定候補の正本 manifest と照合する。実際の Skill 本文を読んだ証拠は、一覧や manifest と分け、read/tool event で確認する。
- raw event log はアクセス制御された一時領域に置く。受け入れ記録には必要な短い証跡だけを転記し、秘密や不要な会話内容を含む raw log をリポジトリに追加しない。

## App Server を使う再現手順

対象 client の実装版で schema を生成し、その schema に記載された method・field を使う。次は `0.162.0-alpha.17.2` の v2 protocol で確認した最小例である。版が異なる場合は先に対象版の schema を生成し直す。

1. OS の一時領域に専用の `CODEX_HOME`、作業 directory、ログ directory を作る。必要な場合は認証だけを隔離 home に用意し、内容は表示しない。対象版の `codex.exe` を子プロセスとして起動し、schema 生成時と App Server 起動時の `CODEX_HOME` はその子プロセスの環境だけへ設定する。`app-server generate-json-schema --experimental --out <temp>/schema` で protocol を生成し、`PluginInstallParams`、`SkillsListParams`、`PermissionProfileListParams`、`ThreadStartParams`、`ThreadStartResponse`、`TurnStartParams`、`ThreadReadParams` を確認する。
2. App Server を `codex.exe app-server --stdio` で起動し、同じ一時 home・試験用作業 directory を渡す。`initialize` を送り応答を待ってから `initialized` notification を送る。
3. 候補 SHA のリポジトリ一式を試験用に用意し、その `.agents/plugins/marketplace.json` を `plugin/install` に指定して対象 Plugin を導入する。カタログだけを別の場所へ移さず、完了応答を待つ。同じ server/client に `skills/list`（`cwds` と `forceReload:true`）を送り、名前・path・enabled を確認する。対象 Skill の path が属する実 cache の manifest から Plugin の `name` / `version` を読み、固定候補の正本 manifest と照合する。同じ cache の版が候補と一致することを確認してから `thread/start` を送る。本文の読込確認は対象 Skill の実 read/tool event で別に行う。
4. `permissionProfile/list` に作業 directory を渡して `:workspace` が利用可能か確認する。`thread/start` を送り、返却された model、reasoning effort、approval policy、reviewer、`activePermissionProfile` を確認する。実効値が事前条件と異なれば turn を開始しない。
5. 対象 Skill は turn の正式 `skill` input として渡す。read 失敗ケースでは、`skills/list` で発見した後、隔離 home 内の対象 Skill 本文だけを一時退避し、`turn/start` を送る。発見後の path と実 read error の両方を記録し、欠落本文は `finally` で復元する。
6. RPC request/response と notification を raw JSONL に同期的に保存する。少なくとも `item/started`、`item/completed`、`turn/completed` を記録する。対象 turn の `turn/completed` notification を確認した後、別 request として `thread/read`（`includeTurns:true`）を送り、返却された `thread.turns` 内で要素の `id` が対象 `turnId` と一致する turn を特定し、`status` と `items` を記録する。通知は `failed` / `interrupted` status の turn にも発生するため、status が `completed` であることを確認して成功と判定する。結果 JSON と必要な応答要約を一時領域に保存した後、`finally` で退避ファイルを復元し App Server を終了する。用意した認証の一時コピーも削除する。秘密・認証値・非公開推論は記録しない。

最小 JSON-RPC 例（`<...>` は実際の一時 path・値に置換し、request ID を重複させない）。Plugin install は各 Plugin に対し一度ずつ行う。

```jsonl
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"acceptance-runner","version":"1"},"capabilities":{"experimentalApi":true}}}
{"method":"initialized","params":{}}
{"id":2,"method":"plugin/install","params":{"marketplacePath":"<candidate>/.agents/plugins/marketplace.json","pluginName":"artifact-workflow"}}
{"id":3,"method":"plugin/install","params":{"marketplacePath":"<candidate>/.agents/plugins/marketplace.json","pluginName":"expert-escalation"}}
{"id":4,"method":"skills/list","params":{"cwds":["<temp>/work"],"forceReload":true}}
{"id":5,"method":"permissionProfile/list","params":{"cwd":"<temp>/work","limit":100}}
{"id":6,"method":"thread/start","params":{"cwd":"<temp>/work","model":"gpt-6-sol","permissions":":workspace","approvalPolicy":"on-request","approvalsReviewer":"auto_review"}}
{"id":7,"method":"turn/start","params":{"threadId":"<thread-id>","input":[{"type":"text","text":"<試験入力>","text_elements":[]},{"type":"skill","name":"<skills/listで取得したWorkflowの正式名>","path":"<skills/listで取得したWorkflow本文の実パス>"}]}}
```

次の `thread/read` は、`turn/completed` notification を確認した後に別途送る。完了前に送って最終結果を回収した扱いにしない。

```text
{"id":8,"method":"thread/read","params":{"threadId":"<thread-id>","includeTurns":true}}
```

この版では `ThreadStartParams` に thread の `model` と `permissions` を指定し、隔離 home の `config.toml` に `model_reasoning_effort = "xhigh"` を設定した。`ThreadStartResponse.activePermissionProfile.id` が `:workspace` であることを確認する。`sandbox` は legacy compatibility field なので profile provenance の判定には使わない。JSON-RPC の response と notification を取り違えず、`thread/start` response 全体は安全な一時証跡として保存するか、保存しない場合は取得した有効値だけの要約であると明記する。

## 任意相談の確認

対象は Reviewer → 親 → Advisor → Worker → Reviewer の責務分担と、親が行う相談の発見・読込・起動・返却の限定動作である。成果物生成フロー全体の成功と混同しない。

1. 試験用の元タスク ID と相談 ID を割り当て、入力・阻害要因・相談役へ渡す問いを記録する。相談結果や期待状態を答えとしてモデルへ誘導しない。
2. 現在の一覧から相談 Skill を発見し、同じ task/thread で本文を読む。発見した名前・版・path と実際の本文読込 event を対応づける。
3. 読込失敗ケースでは、一時コピーの本文だけを制御して読めない状態にする。client の read 呼び出しと失敗結果を観測する。shell で別途ファイルを欠落させた証拠だけでは client の読込失敗を示さない。
4. 起動失敗ケースは、事前確認に成功した後で実 client が相談役の起動を実際に試み、その拒否・失敗と親への返却を観測できた場合だけ成立とする。機能 off、標準 subagent の利用可否、単体契約試験、prompt で指定した期待出力を起動失敗の証拠にしない。
5. 相談結果を受け取った場合は Advisor の実行 ID と返却を記録し、親が助言をどう使ったか、Worker の変更版、Reviewer による変更版再レビューを追う。相談役の出力がない場合は助言に基づく成功・判断済みと記録しない。
6. 相談だけが利用できず、無関係な作業が十分な入力で独立して続けられる場合はその作業だけ継続する。欠けた助言が必要な作業は停止または人間判断待ちとする。

| 観測結果                                           | attempted | execution_state | 判定                                                                 |
| -------------------------------------------------- | --------- | --------------- | -------------------------------------------------------------------- |
| 発見または本文読込が失敗し、相談役を起動していない | `false`   | `not_started`   | `unavailable`。助言なし                                              |
| 事前確認後に起動を試み、実行されなかったと確認した | `true`    | `not_started`   | `no_result`。助言なし                                                |
| 起動後、停止したことを確認した                     | `true`    | `stopped`       | `no_result`。助言なし                                                |
| 起動を試みたが、実行有無を確認できない             | `true`    | `unknown`       | `no_result`。助言なし                                                |
| 起動後に実行中である                               | `true`    | `running`       | 状態確認を続ける。助言なし                                           |
| 相談役の完了と返却を確認した                       | `true`    | `completed`     | 返却状態が `advice` の場合だけ助言取得。ほかの返却状態はそのまま記録 |

`execution_state` は [相談役の契約](../plugins/expert-escalation/skills/expert-escalation/references/advisor-contract.md) の意味に合わせて親が分類し、client の raw status/event は別欄へそのまま記録する。client 固有の `failed` / `completed` を canonical `execution_state` と同一視しない。実起動がないことを確認できた場合は `not_started`、実行有無が不明なら `unknown`、実行中なら `running` とする。`stopped` は停止を確認できた場合だけ使い、timeout のみでは停止と扱わず `running` または `unknown` とする。起動・追加回答の生成を試したかは `attempted` に分ける。起動していないと記録する場合は、起動 request の有無と対応する `item/started` 件数をログから別々に照合し、一般の subagent の起動を相談役の起動と同一視しない。相談役の返却 `input_insufficient`、`inconclusive`、`human_decision_required` は結果を受け取った記録にはなるが、`advice` 取得成功ではない。

実施履歴は[Issue #66 の受け入れ記録](acceptance-records/issue-66.md)を参照する。

## 記録項目

受け入れ結果に次を残す。

- 候補 SHA、OS/architecture、client と build、model と reasoning effort、Plugin 名・版。
- 実効 approval policy、reviewer、permission profile と試験用ディレクトリの実測結果。
- 元タスク ID、相談 ID、親識別子、Reviewer/親/Advisor/Worker の識別子、相談役実行 ID（未起動なら「なし」）。
- 入力 prompt、相談役に実際に渡した情報、実際の read/tool 呼び出し・結果、起動 request と delegation return。失敗時は失敗箇所と client の状態。
- 相談結果、Worker が作成・変更した成果物の版、Reviewer の変更版再レビュー結果。該当しない場合は未実施理由。
- 成立した条件、再現できなかった条件、未確認事項、必要な追加 client/API/環境。ログ参照は秘密を除いた保存先を記す。

再現できないケースは未確認のまま残す。成立しない条件を具体的に示し、実 client から fault を制御できる境界や追加環境が必要なら明記する。
