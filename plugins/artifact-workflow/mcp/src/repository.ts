import type { CleanupResult, Session } from './schema.js';

export type ResetResult = { session: Session; cleanup: CleanupResult };

/** MCPが必要とする4操作。保存方式や環境変数の解決には依存しない。 */
export interface PlanRepository {
  /** 未初期化・回収済みならnull。破損や読み取り失敗は例外として区別する。 */
  get(sessionId: string): Promise<Session | null>;

  /**
   * 指定セッションを初期化し、完了済みの別セッションを回収する。
   * 回収の失敗はcleanup.skippedに記録し、初期化の成功を取り消さない。
   */
  reset(sessionId: string): Promise<ResetResult>;

  /** 最新revisionの未完了セッションだけを更新し、計画全体を置き換える。 */
  save(sessionId: string, expectedRevision: string, input: unknown): Promise<Session>;

  /** 完了済みでもrevisionを検証する。一致すれば保存済みの状態を変更せず返す。 */
  complete(sessionId: string, expectedRevision: string): Promise<Session>;
}
