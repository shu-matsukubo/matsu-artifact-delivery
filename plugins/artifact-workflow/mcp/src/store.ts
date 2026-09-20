import { randomUUID } from 'node:crypto';
import { collectCompleted } from './cleanup.js';
import type { PlanRepository, ResetResult } from './repository.js';
import { planSchema, type Session } from './schema.js';
import { completeSession, createSession, replacePlan, type SessionChange } from './session.js';
import { SnapshotFiles } from './snapshot-files.js';

function newChange(): SessionChange {
  return { revision: randomUUID(), updatedAt: new Date().toISOString() };
}

/** 状態遷移と保存処理をつなぎ、読み取り・revision検証・書き込みを同じロック内で行う。 */
export class PlanStore implements PlanRepository {
  readonly directory: string;
  private readonly files: SnapshotFiles;

  constructor(directory: string) {
    this.files = new SnapshotFiles(directory);
    this.directory = this.files.directory;
  }

  /** 未初期化・回収済みはnull、破損や読み取り失敗は例外として返す。 */
  async get(sessionId: string): Promise<Session | null> {
    return this.files.readSnapshot(this.files.filename(sessionId));
  }

  /**
   * 指定セッションを初期化し、完了済みの別セッションを回収する。
   * 回収の失敗はcleanup.skippedに記録し、初期化の成功を取り消さない。
   */
  async reset(sessionId: string): Promise<ResetResult> {
    const filename = this.files.filename(sessionId);
    const session = await this.files.withLock(filename, async () => {
      const session = createSession(sessionId, newChange());
      await this.files.writeSnapshot(filename, session);
      return session;
    });
    // 複数セッションのロックを同時に持たず、同時開始時の競合を減らす。
    return { session, cleanup: await collectCompleted(this.files, filename) };
  }

  async save(sessionId: string, expectedRevision: string, input: unknown): Promise<Session> {
    const filename = this.files.filename(sessionId);
    const plan = planSchema.parse(input);
    return this.files.withLock(filename, async () => {
      const current = await this.get(sessionId);
      const session = replacePlan(current, expectedRevision, plan, newChange());
      await this.files.writeSnapshot(filename, session);
      return session;
    });
  }

  /** 完了済みでもrevisionを確認し、一致する再実行ではファイルを書き直さない。 */
  async complete(sessionId: string, expectedRevision: string): Promise<Session> {
    const filename = this.files.filename(sessionId);
    return this.files.withLock(filename, async () => {
      const current = await this.get(sessionId);
      const session = completeSession(current, expectedRevision, newChange());
      if (session !== current) await this.files.writeSnapshot(filename, session);
      return session;
    });
  }
}
