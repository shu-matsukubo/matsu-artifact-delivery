import { StoreError } from './errors.js';
import { sessionSchema, type Session } from './schema.js';

export const MAX_SNAPSHOT_BYTES = 1024 * 1024;

/** 保存JSONのサイズと形式を検証する。旧形式のcompletedAt補完はスキーマに従う。 */
export function parseSnapshot(raw: string): Session {
  if (Buffer.byteLength(raw) > MAX_SNAPSHOT_BYTES)
    throw new StoreError('INVALID_DATA', 'Stored session exceeds 1 MiB.');
  try {
    return sessionSchema.parse(JSON.parse(raw));
  } catch {
    throw new StoreError('INVALID_DATA', 'Stored session is not valid session JSON.');
  }
}

/** 完了日時がnullから文字列に増える分を予約し、受理した計画を後から完了できるようにする。 */
export function serializeSnapshot(session: Session): string {
  const completedJson = `${JSON.stringify({ ...session, completedAt: session.completedAt ?? session.updatedAt }, null, 2)}\n`;
  if (Buffer.byteLength(completedJson) > MAX_SNAPSHOT_BYTES)
    throw new StoreError('PLAN_TOO_LARGE', 'The session including completion metadata exceeds 1 MiB.');
  return `${JSON.stringify(session, null, 2)}\n`;
}
