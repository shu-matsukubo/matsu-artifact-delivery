import { StoreError } from './errors.js';
import type { Plan, Session } from './schema.js';

/** 時刻とrevisionを呼び出し側から渡し、状態遷移をI/Oや乱数生成から独立させる。 */
export type SessionChange = Pick<Session, 'revision' | 'updatedAt'>;

export type CompleteSessionResult = { session: Session; changed: boolean };

export function createSession(sessionId: string, change: SessionChange): Session {
  return {
    schemaVersion: 1,
    sessionId,
    revision: change.revision,
    createdAt: change.updatedAt,
    updatedAt: change.updatedAt,
    completedAt: null,
    plan: null,
  };
}

function requireRevision(current: Session | null, expectedRevision: string): Session {
  if (!current) throw new StoreError('NOT_INITIALIZED', 'The session is missing.');
  if (current.revision !== expectedRevision) throw new StoreError('REVISION_CONFLICT', 'The session changed.');
  return current;
}

/** スキーマ検証済みの計画で全置換する。既存の状態と入力計画は変更しない。 */
export function replacePlan(
  current: Session | null,
  expectedRevision: string,
  plan: Plan,
  change: SessionChange,
): Session {
  const session = requireRevision(current, expectedRevision);
  if (session.completedAt !== null) throw new StoreError('SESSION_COMPLETED', 'The session has already completed.');
  return { ...session, ...change, plan };
}

/**
 * 完了記録は同じrevisionでの再実行に限り状態を変えず、changedで保存の要否を返す。
 * 古い計画を見た呼び出しを成功扱いしないため、完了済み判定より先にrevisionを確認する。
 */
export function completeSession(
  current: Session | null,
  expectedRevision: string,
  change: SessionChange,
): CompleteSessionResult {
  const session = requireRevision(current, expectedRevision);
  if (!session.plan) throw new StoreError('PLAN_NOT_SAVED', 'The session has no agreed plan.');
  if (session.completedAt !== null) return { session, changed: false };
  return { session: { ...session, ...change, completedAt: change.updatedAt }, changed: true };
}
