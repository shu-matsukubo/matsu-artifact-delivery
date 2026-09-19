import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { planSchema, sessionIdSchema, sessionSchema, type Session } from './schema.js';

const MAX_BYTES = 1024 * 1024;

export class StoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

export function dataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const directory = env.ARTIFACT_WORKFLOW_DATA_DIR
    ?? (env.PLUGIN_DATA ? join(env.PLUGIN_DATA, 'task-memory') : join(tmpdir(), 'matsu-artifact-workflow', 'task-memory'));
  if (!isAbsolute(directory)) throw new StoreError('INVALID_DIRECTORY', 'The data directory must be an absolute path.');
  return resolve(directory);
}

/** One snapshot per session. No process-global current session and no directory-wide deletion. */
export class PlanStore {
  readonly directory: string;

  constructor(directory: string = dataDirectory()) {
    if (!isAbsolute(directory)) throw new StoreError('INVALID_DIRECTORY', 'The data directory must be an absolute path.');
    this.directory = resolve(directory);
  }

  private filename(sessionId: string): string {
    sessionIdSchema.parse(sessionId);
    // Hashing also avoids Windows reserved names and case-insensitive filename collisions.
    return join(this.directory, `${createHash('sha256').update(sessionId).digest('hex')}.json`);
  }

  async get(sessionId: string): Promise<Session | null> {
    const filename = this.filename(sessionId);
    let raw: string;
    try {
      if ((await stat(filename)).size > MAX_BYTES) throw new StoreError('INVALID_DATA', 'Stored session exceeds 1 MiB.');
      raw = await readFile(filename, 'utf8');
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
    const parsed = (() => {
      try { return sessionSchema.parse(JSON.parse(raw)); }
      catch { throw new StoreError('INVALID_DATA', 'Stored session is invalid. Do not infer or overwrite its plan; inspect it before explicitly resetting.'); }
    })();
    if (parsed.sessionId !== sessionId) throw new StoreError('INVALID_DATA', 'Stored session ID does not match.');
    return parsed;
  }

  async reset(sessionId: string): Promise<Session> {
    const filename = this.filename(sessionId);
    return this.withLock(filename, async () => {
      const now = new Date().toISOString();
      const session: Session = {
        schemaVersion: 1, sessionId, revision: randomUUID(), createdAt: now, updatedAt: now, plan: null,
      };
      await this.write(filename, session);
      return session;
    });
  }

  async save(sessionId: string, expectedRevision: string, input: unknown): Promise<Session> {
    const filename = this.filename(sessionId);
    const plan = planSchema.parse(input);
    return this.withLock(filename, async () => {
      const current = await this.get(sessionId);
      if (!current) throw new StoreError('NOT_INITIALIZED', 'Call reset_session once at the start of a new generation flow.');
      if (current.revision !== expectedRevision) {
        throw new StoreError('REVISION_CONFLICT', 'The session changed. Read get_plan and reconcile with the approved plan before saving again.');
      }
      const session: Session = { ...current, revision: randomUUID(), updatedAt: new Date().toISOString(), plan };
      await this.write(filename, session);
      return session;
    });
  }

  private async withLock<T>(filename: string, action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = `${filename}.lock`;
    const lock = await open(lockPath, 'wx', 0o600).catch(error => {
      if (hasCode(error, 'EEXIST')) {
        throw new StoreError('SESSION_BUSY', `Another writer holds this session. Retry after it finishes. If a process crashed, confirm no writer remains before removing only ${lockPath}.`);
      }
      throw error;
    });
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      return await action();
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }

  private async write(filename: string, session: Session): Promise<void> {
    const json = `${JSON.stringify(session, null, 2)}\n`;
    if (Buffer.byteLength(json) > MAX_BYTES) throw new StoreError('PLAN_TOO_LARGE', 'Keep the session under 1 MiB; store references instead of artifact contents.');
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(json, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      // Replace the old snapshot only after the complete new JSON is on disk.
      await rename(temporary, filename);
    } finally {
      await unlink(temporary).catch(error => { if (!hasCode(error, 'ENOENT')) throw error; });
    }
  }
}
