import type { CleanupResult, Session } from './schema.js';

/** MCPが必要とする計画ライフサイクルと明示的な回収操作。保存方式には依存しない。 */
export interface PlanRepository {
  /** 未初期化・回収済みならnull。破損や読み取り失敗は例外として区別する。 */
  get(sessionId: string): Promise<Session | null>;

  /** 未作成の場合だけ初期化し、既存セッションを保持する。 */
  initialize(sessionId: string): Promise<Session>;

  /** 指定セッションだけを明示的に初期化し直す。 */
  reset(sessionId: string): Promise<Session>;

  /** 完了記録済みのセッションを明示的に回収する。 */
  collectCompleted(): Promise<CleanupResult>;

  /** 最新revisionの未完了セッションだけを更新し、計画全体を置き換える。 */
  save(sessionId: string, expectedRevision: string, input: unknown): Promise<Session>;

  /** 完了済みでもrevisionを検証する。一致すれば保存済みの状態を変更せず返す。 */
  complete(sessionId: string, expectedRevision: string): Promise<Session>;
}
