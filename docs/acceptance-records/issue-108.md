# Issue #108 実モデル受け入れ記録

2026-10-31 に固定候補をこの Windows ノートパソコンで確認した結果を記録する。通常の手順は[実モデル受け入れ手順](../model-acceptance.md)を参照。

## 候補と環境

- 候補 SHA: `351db662b58575b856084d200f6ad208bd3e4001`（`main`、20コミット）
- Windows x64、Node.js `22.23.4`、Codex CLI / App Server `0.166.0`
- `gpt-6-sol` / `xhigh`、approval policy `on-request`、reviewer `auto_review`、有効な permission profile `:workspace`
- `artifact-workflow 0.5.0`、`expert-escalation 0.1.2`
- 隔離した一時 `CODEX_HOME` と作業ディレクトリを使用。各 Plugin の実キャッシュ内 manifest は候補と一致し、Workflow の `skills/list` では正式 Skill が有効だった。通常の Codex 設定・cache・保存済み計画は変更していない。
- モデルへの接続と推論は、この隔離 home に限って実行した。隔離 home の `task-memory` 配下でローカル MCP の起動と保存を確認した。別の `codex_apps` connector は handshake error で起動しなかったが、受け入れ対象のローカル MCP は正常に利用できた。

## 自動試験と配布物

- ルートおよび MCP の `check`、`lint`、`format:check` が成功。
- `npm test`: 279件成功、失敗0、skip 0。Windows 専用試験5件もすべて成功。
- `npm run package` と `plugins/artifact-workflow` の `check:dist` が成功。同梱 Node.js `22.23.2` runtime の由来照合も成功。
- `npm run test:install -- --github-ref 351db662b58575b856084d200f6ad208bd3e4001` が成功。`dist` と GitHub の両導入経路で cache の内容が候補と一致し、portable / compatibility の双方で Windows MCP runtime を起動した。
- 自動試験の要約ログは一時領域の `issue108-automated.log`、インストール試験は `issue108-install.log` に保存した。両ファイルはリポジトリ外にある。

## 主試験: 登録方針の自律選定と承認後完了

登録方針は「与えられた数値だけを使う。メモの末尾に『確認済み』を独立した1行として記載する。」（`markdown-sales-memo`、revision `f44799e0-337c-4e90-aa95-d6b802b3d50c`）。新しい空の作業フォルダーで正式 `artifact-workflow` Skill input を指定し、次の依頼を与えた。方針・MCP・末尾表記には触れていない。

> この作業フォルダーに sales-note.md を作成してください。Markdownでタイトル「売上メモ」、入力値の箇条書き（A: 3、B: 5）、合計8を記載してください。入力以外の数値は追加しないでください。外部公開は不要です。最初に計画を提示し、私の承認を待ってください。承認前に計画を保存したり、担当へ委任したり、ファイルを作成したりしないでください。

提案 thread / turn `01a19223-aa08-73a2-98d9-feccba97e618` / `01a19223-aa36-73a1-98d5-ceb7069f5827` は完了した。実 MCP `list_extensions` (`exec-43fab475-b579-4a87-b60a-4862f4117185`) と `get_extension` (`exec-cc08ae20-6981-45aa-9fe2-b4a8b15c33a8`) が計画提示前に成功し、同じ方針の全文・revisionを取得した。モデルは適用理由を示して方針を自律選定し、要件・完了条件へ末尾行を含めた計画を提示して明示承認を待った。承認入力は別 turn に次の一文だけを与えた。

> 提示した計画を承認します。その計画の作成・独立レビュー・検証・提示・完了記録まで進めてください。

承認後 turn `01a19224-cbbb-7232-b1b9-a34572097ae2` も対象親 thread の `turn/completed` と `thread/read` の双方で `completed`。session `fdd62f4e-37fe-4e51-b711-1dbc81ea0bef` は `complete_session` 成功、完了 revision `ed1e5f46-fea7-4838-a08f-0d53ffb52aa9`。Worker `01a19226-259e-76c2-a3a9-21952c1b6d2d`（`gpt-6-luna` / `medium`）と独立 Reviewer `01a19227-0780-7742-954b-519676736553`（`gpt-6.1-sol` / `low`）は別 thread で完了し、指摘なし。双方の `get_plan` は同じ `markdown-sales-memo` revision `f44799e0-337c-4e90-aa95-d6b802b3d50c` を示した。親の最終検証・提示・完了記録も確認した。`sales-note.md` の SHA-256 は `CB68D2726E9E771786DC432AD45C90B71210AA870BCEA0C632614E8BDA441B3A`。ファイルは承認内容と一致し、数値は `3`、`5`、`8` のみ、末尾行は独立した「確認済み」だった。主試験の安全な要約は OS 一時領域 `C:/Users/docha/AppData/Local/Temp/issue108-acceptance/` の `natural-workflow-natural-summary.json` と `natural-workflow-approve-summary.json` にある。

## 事前確認と承認ゲート

対象版 CLI の `app-server generate-json-schema --experimental --out <一時ディレクトリ>` で v2 schema を生成し、method と field を確認した。App Server は `--listen stdio://` で起動した。隔離ディレクトリへの短い事前 turn は `completed` となり、`preflight.txt` に書いた `PREFLIGHT_OK` を読み戻した。thread/start の応答で model `gpt-6-sol`、reasoning effort `xhigh`、approval policy `on-request`、reviewer `auto_review`、`activePermissionProfile.id` `:workspace` を確認した。

以下の明示待機試験では、正式な `artifact-workflow` Skill を input に指定し、試験用の別作業ディレクトリを使った。最初の plan turn は完了し、承認前に計画保存・生成委任・ファイル作成がなかった。no-policy の一覧確認は実際の `artifact-task-memory` MCP tool call `list_extensions`（item `exec-2ac27335-c43f-44bd-b6aa-5698c7aa596e`）で成功し、応答 `{ "extensions": [] }` を得た。対象がないため `get_extension` は呼び出していない。対象 Skill 本文と参照資料も同じ試験 thread の `commandExecution` read event で確認した。

| 段階                   | thread / turn                                                                                        | 結果                                                                                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no-policy の計画提示   | `01a1920c-01fa-7db0-ba8f-c203c1186df0` / `01a1920c-0224-7d12-97f3-fa4880b12d7c`                      | `list_extensions` 成功、登録済み方針なし。計画を提示し別入力の明示承認を待機。                                                                                                                                                                                |
| no-policy の承認後処理 | 同 thread / `01a1920d-967b-71b3-94eb-1406e0322864`、継続 turn `01a19211-0f4d-7e90-80ff-0196a056c9df` | 初回の試験 runner が子 turn の完了を親 turn と誤認して App Server を終了し、親 turn は `interrupted` になった。親の完了と判定せず、保存済み計画の継続を促す試験入力後、親 turn の一致する `turn/completed` と `thread/read` の双方で `completed` を確認した。 |

no-policy の承認は別入力で行い、計画の `approval.evidence` はその入力と直前の計画を対応づけた。隔離 task-memory session `3b135c87-5a41-48be-8c68-d53f16b166af` は `complete_session` 成功、最終 revision `184bab1f-5ef3-4fb4-9001-0dd1b6b0ab1c`。Worker `01a1920e-d0c7-71a3-b103-7d1c78e16545` と Reviewer `01a19211-8119-76e3-8cce-1a267b7c10fe` は別 thread で、各 turn が `completed`。両者の開始時設定は `gpt-6-sol` / `xhigh` だった。Worker が作った `sales-note.md` は Reviewer の読み取り・検証後も SHA-256 `948FD2180EA4F88F70EB6C4719C3F76C25910A9F38636EC62ADF3F73D25C856D` で一致した。親はその実物を検証し、提示してから完了記録を行った。

no-policy の補助確認では正式 `artifact-workflow` Skill input と次の入力を使い、計画への明示承認は別入力で行った。成果物内容と承認待ちに加え、計画前の方針一覧・全文取得と本文・revision の計画記載を補助指示した。方針本文・末尾行そのものは指定していない。

> artifact-workflow を使ってください。この作業フォルダーに sales-note.md を作成し、タイトル「売上メモ」、入力値 A: 3 と B: 5、合計 8 を記載してください。入力以外の数値を追加しないでください。外部公開は不要です。最初の応答では作業計画だけを提示し、私の明示承認を待ってください。承認前は計画保存、担当への委任、ファイル作成を行わないでください。適用できる共通方針があれば計画前に一覧・全文を取得し、本文とrevisionを計画へ含めてください。

## 登録方針 snapshot の補助確認

一時保存先の管理 thread `01a19213-fb02-7a20-855c-2584ceee8508` で `extension-management` Skill を正式 input にし、提案 turn `01a19213-fb2e-7f61-85ef-73170580858c` では登録せず別入力の明示同意を待った。同じ thread の同意 turn `01a19214-9f3f-7ad1-9fda-23e4ca332373` で `register_extension` と `get_extension` を実行し、次の方針を隔離 task-memory へ1件登録した。

- ID / 名前: `markdown-sales-memo` / Markdown売上メモ
- revision: `f44799e0-337c-4e90-aa95-d6b802b3d50c`
- 本文: 「与えられた数値だけを使う。メモの末尾に『確認済み』を独立した1行として記載する。」

新しい Workflow thread `01a19215-6795-78e1-8dfa-f0e63f6c39dd` の計画 turn `01a19215-67c0-7db3-b29c-1253b8dc5da0` では、実 MCP tool `list_extensions` と `get_extension` が計画提示前に成功した。計画には方針 ID・名前・選定理由・固定本文・revision・依存先が含まれ、別入力の明示承認を待った。承認後の親 turn `01a19216-5b82-7603-b44b-4cc6de92820f` は、同じ本文・revision を持つ計画を保存してから生成へ進んだ。

提案時の入力は次のとおりで、方針への適用を促す指示に加えて、補助条件として実際の `list_extensions` / `get_extension` 呼び出しと固定本文・revisionの計画記載を指定した。

> artifact-workflow を使ってください。この作業フォルダーに sales-note.md を作成してください。タイトルは「売上メモ」、値は A: 3、B: 5、合計 8 です。方針にある「確認済み」を最後に入れてください。方針から数値を追加しないでください。最初に計画を提示し、私の明示承認を待ってください。承認前の計画保存、委任、ファイル作成は禁止します。共通方針は提示前に必ず list_extensions と該当候補への get_extension を実際に呼び、固定本文とrevisionを計画に含めてください。

Worker thread `01a19217-7d56-7980-8385-fbb2b1f0cbbf` と独立 Reviewer thread `01a19218-85a4-7f11-80f7-a17a6d2ccabb` は別々に起動・完了した。各開始 event は `gpt-6-sol` / `xhigh`、両者の task-memory `get_plan` 結果と Reviewer の返却は同じ方針 ID・revision・本文を示した。Reviewer は指摘なしとし、レビュー前後の SHA-256 `72DEAD7A5746F089BBF933D4A35E5B5FD5F1F717CA2D6B9AFA4224AEA2CC247F` が一致した。親は実ファイル全体と末尾の独立行「確認済み」を読み、余分な数値がないことを確認して提示し、`complete_session` を成功させた。隔離 session `462ae9bb-a77f-4c0e-b9b4-c8d612bff645` の完了 revision は `ef3b9815-eea5-4dee-acfc-f55a2fd53897`。

方針選定の三つの区別も、同じ固定候補と隔離保存先で確認した。各条件の観測を促す補助指示を入力に含めており、通常入力からモデルが自律してケースを判断する試験ではない。

- **実矛盾:** 今回は末尾行を入れないよう要求し、方針と衝突する箇所・今回不適用にする範囲を計画へ記録し、両立する条件は維持するよう補助指示した。計画を提示して別入力の承認を待った。
- **今回限りの変更:** 明示した今回限りの指示を根拠に末尾行を適用せず、方針を更新しないよう補助指示した。計画を提示して別入力の承認を待った。
- **取得失敗:** 隔離保存先の `extensions.json` のみを一時的に不正 JSON にして正式 Skill input の turn を開始した。`list_extensions` が `INVALID_DATA` を返したため、該当なしと扱わず、`get_extension` や計画提示の前に停止した。承認待ちの計画は提示していない。

| 条件                     | thread / turn                                                                   | 結果                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 今回の要求と方針の実矛盾 | `01a1921d-16ef-7992-b7ce-3493bd1edb61` / `01a1921d-171a-7172-bd03-eb3f092de65e` | 実 MCP `list_extensions` / `get_extension` で同じ revision を取得。数値の指示は適用し、「確認済み」を入れないという要求と衝突する末尾行だけを今回適用しない計画を提示。                                                                                                                                 |
| 明示された今回限りの変更 | `01a1921e-138b-70c0-a9da-ac30b8a98a36` / `01a1921e-13b3-7210-90bf-9fa53629e9bf` | 同じ snapshot を取得・固定。ユーザーの明示指示を根拠に、この成果物に限って末尾行を適用しない計画を提示。共通方針は更新しない。                                                                                                                                                                          |
| 方針取得の失敗           | `01a1921f-1922-7e11-9c08-1acaa9e17999` / `01a1921f-194a-7111-a0de-f13b9ea1404f` | 隔離 home の `extensions.json` を一時的に不正 JSON にし、実 MCP `list_extensions` の `INVALID_DATA` を観測。該当なしと扱わず、`get_extension`・計画提示・保存・委任・生成の前に停止。`finally` で復元し、破損前後の SHA-256 `e4e0b25c3dd63ca49698ebdc6ee4db9d2cef18635b4e400bbe55f85556f17302` が一致。 |

## 任意相談

正式 `expert-escalation` Skill input から相談を1件実行した。親 thread / turn は `01a1921a-c6b5-76a0-abfd-c624ee65cca8` / `01a1921a-c6de-78e3-8345-15ba0c130da0`、相談 ID `E-108-01`、元タスク ID `E-108-01-T0`。相談役 thread / turn `01a1921b-5fb9-7c21-9332-c393cd32baf2` / `01a1921b-6026-7931-b501-891359c59c3a` は `completed` で、実返却状態は `human_decision_required`。7日後の必須削除と30日利用可能の両立を否定し、保持期間の優先順位を人間が決める必要があると返した。相談役の生成・返却を確認したが、これを `advice` 取得成功とは記録しない。

親は限定された整合性確認に `gpt-6-luna` / `medium` を要求し、その選定理由を返却に記録した。親への相談起動応答自体は実効値を示さなかったため、要求値と実効値は同一視していない。App Server の `SubAgentActivity` 開始 event および相談役 thread/read の `thread.model` / `thread.reasoningEffort` は `gpt-6-luna` / `medium` を示した。実行状態は `completed`。相談役の表示識別子は `/root/e10801_advisor`。

## 未確認範囲

- 通常の作成依頼（承認待ちを明示しない入力）がこの client でどう扱われるかは未確認で、保証・解消済みとは評価しない。今回の試験は明示的な承認待ち入力を使った。この制限は[Issue #97 の受け入れ記録](issue-97.md)と対応条件を参照。
- 親より高い能力が必要な相談のモデル選択、model/effort 指定に対応しない起動 API への fallback、相談役の起動拒否・起動失敗は未確認。
- 生成・独立レビュー・完了記録までの no-policy と registered-snapshot フローを確認した。実矛盾・今回限りの変更は計画提示後に別入力の承認待ちとなり、取得失敗は計画提示前に停止した。三条件ではその後の生成を試していない。
- 初回 no-policy 承認turnは試験runnerが子turn完了を親完了と誤認して終了したため `interrupted`。これは合格判定に含めず、継続した最終親turnの完了を別途確認した。また、追加試験の初回起動は認証コピー削除後のrunner準備失敗（401）で、認証コピーを再配置して再実行した。ネットワーク制限下の事前turn失敗も含め、これらの診断・準備失敗を合格判定に含めていない。記録した各最終判定turnは対象thread/turn一致の `turn/completed` と `thread/read` で `completed` を確認した。

試験用認証コピーは終了後に削除した。raw rollout と認証はリポジトリへ含めず、記録には必要なイベント ID・実効設定・合成データの短い結果だけを残した。受け入れ用 TypeScript harness と安全な要約ログは OS 一時領域 `C:/Users/docha/AppData/Local/Temp/issue108-acceptance/` に置いた。主試験要約は `natural-workflow-natural-summary.json` と `natural-workflow-approve-summary.json`。
