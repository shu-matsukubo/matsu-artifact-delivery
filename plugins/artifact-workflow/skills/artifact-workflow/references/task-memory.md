# 計画セッションのライフサイクル

`artifact-task-memory` は承認済みの全体計画と revision を保持する。承認・進捗・成果物・完了条件の自動判定は行わない。承認根拠は [approval.md](approval.md) を正本とする。

## 初期化

- 新しい生成フローの計画を始める前に一度だけ、親がUUIDの `sessionId` を発行し `initialize_session({sessionId})` を呼ぶ。会話・スレッドIDを流用しない。許容文字は英数字・`_`・`-`、長さ1〜128。
- `SESSION_EXISTS` なら既存計画を保全し、必ず別のUUIDを発行して初期化をやり直す。同一フローの明確な続行に限り同じIDで `get_plan` を使う。
- 続行、会話短縮、MCP再接続、worker/reviewer起動では初期化しない。IDが不明なら引継ぎ情報から特定し、推測の別IDを使わない。
- 同一フローの全担当は親の `sessionId` を共有する。異なるフローには異なるIDを割り当てる。

## 操作一覧

| 操作 | 実行者・入力 | 前提と結果 |
| --- | --- | --- |
| `initialize_session` | 親・`sessionId` | 新規フロー開始時に未作成セッションを作る。既存なら変更せず `SESSION_EXISTS`。 |
| `get_plan` | 全担当・`sessionId` | 保存済み全計画、`revision`、`completedAt` を読む。未初期化・削除済みは `session: null`。 |
| `save_plan` | 親・`sessionId`, `expectedRevision`, `plan` | 承認済み計画全体を最新 revision と照合して置換し、新 revision を返す。 |
| `reset_session` | 親・`sessionId` | 利用者が対象計画の置換を明示的に許可した場合だけ、指定IDを空にする。 |
| `complete_session` | 親・`sessionId`, `expectedRevision` | 全作業・全体検証・提示/引き渡し完了後に記録し、`completedAt` と新 revision を返す。 |
| `collect_completed_sessions` | 親・引数なし | 利用者が完了済み計画の回収を明示的に許可した場合だけ、完了記録済みセッションを回収する。 |

初期化・計画保存・完了記録・既存計画の置換・完了計画の回収は親だけが行う。worker と reviewer は `get_plan` のみ。MCPを参照できない委任先には親が取得した最新スナップショットを渡す。

## 保存・更新

- 承認待ちを表す値は保存できない。承認根拠または省略指示・適用範囲を記録してから保存する。
- 保存前、委任・生成・レビュー・検証の前に `get_plan` で最新計画を読む。保存失敗や欠落を成功とみなさず、合意内容が確認できて保存成功するまで作業を始めない。
- 更新は変更理由と承認を確認し、最新計画を読み直して全体を書き戻す。`expectedRevision` は最新値を使い、配列のマージや部分更新はしない。未確定案で置換しない。
- 計画は `request`, `scope`, `requirements`, `constraints`, `inputs`, `tasks`, `acceptanceCriteria`, `delivery`, `approval` を含む。必要な入力・制約・出力先を省略せず、進捗は計画から推測せず実物で確認する。task は `id`, `description`, `purpose`, `deliverable`, `acceptanceCriteria`, `dependsOn` を持つ。ID重複・計画外依存・循環を許さず、各タスクと全体に完了条件を1件以上記す。
- `approval.mode` は `approved` または `waived` とし、`evidence` に承認根拠、または明示的な省略指示と適用範囲を記す。MCPはユーザー発言の真偽を照合しない。
- `session: null` は未初期化/削除済み、`plan: null` は計画未保存を示す。未保存案や会話から推測した計画で作業しない。完了後の修正は新しいフローを開始し、終了済みフローを再開しない。

## 完了

- 全タスク完了だけでは完了記録をしない。全体検証と成果物・結果の提示/引き渡し後、親が最新 revision で `complete_session` を呼び、成功を確認する。
- 完了計画は利用者が明示的に許可した回収または対象ID置換まで読み取り専用。新規フローで他の計画を回収しない。
- 完了記録後の修正は新規フローで計画する。削除済み計画の復元や終了済みフロー再開を前提にしない。

## 回収

- `collect_completed_sessions` は完了記録済み計画だけが対象。未完了、成果物本体、無関係ファイルを削除しない。
- 初期化・保存・完了記録と共通のセッションロックを取得して内容を検証する。ID/ファイル名不一致、破損、未対応形式、通常ファイルでないもの、ロック中・読書きエラーは削除しない。
- `cleanup.deleted` は件数、`cleanup.skipped` はファイル名と理由コード。ディレクトリ一覧取得失敗は `file: "."`。保存先がまだない場合は `{deleted: 0, skipped: []}`。正常な未完了セッションは保持し、見送りに含めない。
- 古い未完了形式や完了未記録データは自動削除しない。履歴・TTL・他チャット復元を設けず、長期保存を保証しない。

## 保存場所

作業データや代替タスク管理ファイルをリポジトリ・Plugin ソース配下に作らない。既定は `PLUGIN_DATA/task-memory/`、直接起動時はOS一時領域の `matsu-artifact-workflow/task-memory/`。`ARTIFACT_WORKFLOW_DATA_DIR` は絶対パスでリポジトリ外を指定する。セッションJSONは `schemaVersion`, `sessionId`, `revision`, `createdAt`, `updatedAt`, `completedAt` を含む。`completedAt` は未完了なら `null`、完了記録時にMCPが設定する。旧データで欠落しても完了を推測しない。ファイル名は `sessionId` の SHA-256 名とし、大文字小文字や予約名の衝突を避ける。最大1 MiBで、成果物本体でなく参照先を保存する。

## エラー

| エラー | 対応 |
| --- | --- |
| `REVISION_CONFLICT` | 最新 `get_plan` と合意を照合し、必要なら計画全体を再保存。強制上書き・競合回避初期化をしない。 |
| `SESSION_BUSY` | 同じ処理の終了を待ち再取得。他セッションは継続可。残留 `.lock` は書き込みプロセス終了を確認後、そのロックだけを削除。 |
| `SESSION_COMPLETED` | 上書きせず、新しい修正フローを計画。 |
| `PLAN_NOT_SAVED` | 合意済み計画を保存後、作業・検証・引き渡しを確認。 |
| `NOT_INITIALIZED` | 同一フローならIDを確認。後日の修正なら新しいフローを開始。 |
| `SESSION_EXISTS` | 既存計画を保全。新規フローは別UUIDで初期化。同一フローの明確な続行だけ既存IDを取得。 |
| `INVALID_DATA` | 内容を推測で補わず確認。復旧の `reset_session` は対象計画置換の明示許可がある場合だけ。 |

保存は同じOSユーザーのローカル利用を前提とする。`sessionId` は識別子であり認証・アクセス制御境界ではない。
