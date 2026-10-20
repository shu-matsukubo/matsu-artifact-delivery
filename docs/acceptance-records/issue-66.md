# Issue #66 実モデル受け入れ記録

この文書は 2026-10-20 時点の候補 SHA に対する限定試験の履歴である。通常手順は[実モデル受け入れ手順](../model-acceptance.md)を参照する。

## 対象と環境

- 候補 SHA: `772774c495f3d12024844d47d8a7c3594c095c93`
- Windows x64、Codex CLI / App Server `0.162.0-alpha.17.2`
- `gpt-6-sol` / `xhigh`、effective permission profile `:workspace`、approval policy `on-request`、reviewer `auto_review`
- `artifact-workflow 0.5.0`、`expert-escalation 0.1.2`
- 実ユーザーの設定・cache・保存済み計画は変更せず、一時 `CODEX_HOME` と一時作業ディレクトリを使用。
- 事前診断の MCP 保存先は隔離 home の `plugins/data/agent-plugins/<id>/task-memory` 配下であることを実ファイルの配置で確認した。正式試験の `mcpToolCall` は 0 件。試験用に複製した認証は終了後に削除した。

## 発見後の本文読込失敗

実行順は `skills/list` → `thread/start` → 隔離 home の `expert-escalation` 本文を退避 → `turn/start`（正式 `artifact-workflow` Skill input）である。turn 中に Workflow 本文の読み込みは成功し、発見済み `expert-escalation` の本文 `Get-Content` は実際の対象 `SKILL.md` 不在で失敗した。親への返却は相談を起動しておらず助言を得ていないと明示した。

この試験で追加確認できたのは、発見後の本文 read が実際に失敗したことと、相談役を起動しなかったことまでである。親の観測から `unavailable` / `attempted:false` / `not_started` / 起動 0 回に分類できるが、client の明示的な状態返却ではない。未取得助言を成功または判断済みとして扱っていない。

- 親 thread: `01a159c1-5b8f-7113-b6dc-b64c2b60d9ff`
- turn: `01a159c1-5bd2-7113-8115-621f021a0467`
- 元タスク ID: `E-66R1-T0`、相談 ID: `E-66R1`。親識別子は本試験 thread。Advisor 実行 ID: なし。
- 入力全文:

  ```text
  $artifact-workflow を使って、次の設計判断をこのタスク内で整理してください。読み取り専用の相談役として $expert-escalation を使い、相談ID は E-66R1、元タスクIDは E-66R1-T0 とします。相談役には、与えられた要件の両立可能性と人間が決めるべき点だけを尋ねてください。返答を受け取ったら判断根拠をまとめてください。ファイル変更や外部連絡は不要です。

  運用責任者は、監査ログを保存開始から7日後に必ず削除するよう求めています。事業責任者は、同じ監査ログを保存開始から30日間利用できるよう求めています。対象ログ、保存先、期間の起点は同一で、例外や分離はありません。両方の要件は有効で、改定権限は各責任者だけにあります。どちらの要件も満たせない案があることは確認済みです。
  ```

- 実効 thread 設定: model `gpt-6-sol`、reasoning effort `xhigh`、approval policy `on-request`、reviewer `auto_review`、`activePermissionProfile.id` `:workspace`。
- 短い証跡: Workflow 本文 `Get-Content -Raw` 成功（event `exec-cd610106-49d8-46ff-81e2-d0fc72ef0c08`）。expert 本文 read は失敗・exit 1（events `exec-a465119c-0b93-44d3-b574-4f4da419624a`、`exec-3852d1f8-9992-4ab7-ba8e-bfdc2b08ed89`）。Advisor の spawn/collabAgentToolCall/subAgentActivity 完了イベントは 0 件。turn は `turn/completed` し、最終返却は「必要な Skill が欠けているため、手順に従ってここで停止します」「相談は起動しておらず」とした。
- 一時保存した `workflow-structured-thread.json` は thread/start 全 response ではなく、上記の thread ID・実効設定・permission profile・sandbox・work path を抜粋した要約。raw イベントは試験ルートの `formal-read-test/workflow-structured.jsonl`（一時ログ、リポジトリ外）。

この入力は `expert-escalation` の利用と助言受領後の判断を明示的に求めていたため、相談不能時に無関係な作業を継続する判断は確認していない。返却は Skill を利用可能にして再開するよう求めており、この入力条件で停止したこと自体を製品不具合とは判定しない。実行ログに Plugin cache の探索が含まれ、Workflow の探索範囲制約への適合も確認できていない。

別の事前診断では、client が読込失敗を確認できない条件で標準 subagent が実行され、助言も返った。この診断は失敗受け入れとして数えない。PowerShell の独立した `Get-Content` 失敗確認も filesystem 状態の証拠に限り、client 失敗の証拠にはしていない。

今回の記録は本文 read の実失敗と相談役の起動なしのみを追加確認する。相談役の起動経路には到達しておらず、起動失敗は未確認。相談不能時の自律判断・無関係作業継続、探索制約、全体連携も未確認であり、この run を全体合格とはしない。

相談役の起動失敗を確認するには、事前確認の通過後に実 client の起動境界で拒否を発生させ、実際の起動 request と失敗返却を観測できる隔離環境が必要である。今回の標準起動経路では、その条件を安全に制御する方法を確立できなかった。機能 off や起動済み相談の期限超過を代用しない。任意相談の自律判断と通常作業の継続には、助言が必要な範囲と独立して進められる範囲を含む入力での追加確認が必要である。退避した本文は試験終了後に復元した。

## リリース時の確認範囲

| 区分     | 確認内容                                                                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 既存確認 | 成功経路 Reviewer → 親 → Advisor → Worker → Reviewer と未導入・無効・曖昧ケースの結果は[Issue #66 の既存記録](https://github.com/shu-matsukubo/matsu-artifact-delivery/issues/66#issuecomment-6279097890)から引き継ぐ。 |
| 今回確認 | 発見後の本文 read 実失敗と相談役の起動なし。                                                                                                                                                                            |
| 未確認   | 相談役起動そのものの失敗、任意相談の自律判断と相談不能時の無関係作業継続、Workflow の探索制約、計画保持・自律相談・変更版再レビューを通した生成フロー全体。                                                             |

この範囲表はリリース全体の合格・許可を宣言するものではない。
