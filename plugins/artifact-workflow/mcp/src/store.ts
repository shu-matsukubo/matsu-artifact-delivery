import { randomUUID } from 'node:crypto';
import { collectCompleted } from './cleanup.js';
import { StoreError } from './errors.js';
import type { PlanRepository } from './repository.js';
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

  /** 新規セッションだけを作り、既存状態は保持したまま競合として返す。 */
  async initialize(sessionId: string): Promise<Session> {
    const filename = this.files.filename(sessionId);
    return this.files.withLock(filename, async () => {
      if (await this.files.readSnapshot(filename)) {
        throw new StoreError('SESSION_EXISTS', 'The session already exists.');
      }
      const session = createSession(sessionId, newChange());
      await this.files.writeSnapshot(filename, session);
      return session;
    });
  }

  /** 指定IDの状態だけを明示的に初期化し直す。 */
  async reset(sessionId: string): Promise<Session> {
    const filename = this.files.filename(sessionId);
    return this.files.withLock(filename, async () => {
      const session = createSession(sessionId, newChange());
      await this.files.writeSnapshot(filename, session);
      return session;
    });
  }

  async collectCompleted() {
    return collectCompleted(this.files);
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
      const { session, changed } = completeSession(current, expectedRevision, newChange());
      if (changed) await this.files.writeSnapshot(filename, session);
      return session;
    });
  }
}
