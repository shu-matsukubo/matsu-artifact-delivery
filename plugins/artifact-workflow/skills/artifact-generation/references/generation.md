# 生成委任と作業

親は承認済み計画から作業タスクを割り当て、[Worker の役割](../assets/worker.md)と[共通のモデル選定・起動方針](../../artifact-workflow/references/model-selection.md)に従って標準 subagent の `spawn_agent` で `artifact-worker` を起動する。承認・更新権限は [approval.md](../../artifact-workflow/references/approval.md)、[task-memory.md](../../artifact-workflow/references/task-memory.md) を正本とする。

## 委任前

- 最新の `get_plan` を読み、担当範囲・依存・タスクIDを確認する。計画が変わったら作業を止め、親が承認と全体更新を済ませてから再委任する。
- 独立して進められ、並列化が有効な場合に限り複数人を割り当てる。worker は同時最大3人。依存先、共有ファイル、担当範囲が競合する割当てを避ける。
- 標準 subagent を起動できなければ親が自分で生成せず、阻害要因を報告して停止する。
- 相談を併用する場合は [相談の実行枠](../../artifact-workflow/references/escalation.md)を確認する。

## 委任時に渡す情報

worker への割当て・入力・返却項目の正本は [worker.md](../assets/worker.md)。委任文には同ファイルの役割指示、タスクに必要な入力資料、参照ファイルを読める状態で含める。あわせて次の参照を渡す。

- [生成の原理原則](generation-principles.md)
- [承認済み計画の最新スナップショット](../../artifact-workflow/references/task-memory.md)（MCP参照不能時）
- 選択した生成拡張の全文と選定理由（該当時）

委任文の入力項目と返却形式は worker.md を正本として渡し、重複した形式を作らない。worker は相談に依存する作業を止め、問い・証拠・試行・進行中処理・再開位置を親へ返して実行を終える。

## 拡張の選定

- 親が `list_extensions` を `type: generation` で呼び、概要・対象・適用条件が明確に一致するものだけ選ぶ。類似だけでは選ばない。
- 0〜1件を担当タスクごとに選び、`get_extension` で全文と最新 `revision` を照合する。更新されていたら一覧から選び直す。
- [実行境界](../../artifact-workflow/references/execution-boundaries.md)に従う。エラーや不正データを空一覧と見なさず、使えない場合は理由を伝えて共通原則で続行する。作業中の追加選定も親が行う。
- 親は選択指示のID・対象・選定理由を worker に渡す。

## 作成・修正

- [生成の原理原則](generation-principles.md)と選定された指示だけを適用する。品質判定・完了条件の変更・独自の品質チェックリストは行わない。
- タスクID・成果物の対応、担当範囲、制約、依存を保つ。共有・他担当の変更を上書きしない。
- テスト、型検査、描画・動作確認など、成果物の生成手順に必要な確認は作業中に行い、結果を返す。
- 後続処理を実行せず、その担当側で必要な作成・編集もしない。結果が必要なら不足入力とタスクIDを親へ返す。

## 返却後

worker は [worker.md](../assets/worker.md) の返却形式で実物・確認結果・未解決点を返す。親は同じタスクIDを維持し、別担当による[独立レビュー](../../artifact-review/references/independent-review.md)へ進む。指摘修正・再レビュー後の完了判定は [verification.md](../../artifact-workflow/references/verification.md) に従う。
