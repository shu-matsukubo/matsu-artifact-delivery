import { createHash, randomUUID } from 'node:crypto';
import fs, { lstat, mkdir, readFile, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { StoreError, systemErrorCode } from './errors.js';
import { sessionIdSchema, type Session } from './schema.js';
import { MAX_SNAPSHOT_BYTES, parseSnapshot, serializeSnapshot } from './snapshot.js';

/** 同じディレクトリの一時ファイルを同期してから置換し、途中までのJSONを読ませない。 */
export async function writeFileAtomically(filename: string, contents: string): Promise<void> {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, filename);
  } finally {
    await unlink(temporary).catch((error) => {
      if (systemErrorCode(error) !== 'ENOENT') throw error;
    });
  }
}

/** セッションファイルの命名・読み書き・排他制御を担当し、状態遷移の条件は判断しない。 */
export class SnapshotFiles {
  readonly directory: string;

  constructor(directory: string) {
    if (!isAbsolute(directory))
      throw new StoreError('INVALID_DIRECTORY', 'The data directory must be an absolute path.');
    this.directory = resolve(directory);
  }

  filename(sessionId: string): string {
    sessionIdSchema.parse(sessionId);
    // Windowsの予約名と、大文字小文字を区別しないファイル名の衝突も避ける。
    return join(this.directory, `${createHash('sha256').update(sessionId).digest('hex')}.json`);
  }

  /** 不在だけをnullとする。破損・別IDの内容・通常ファイル以外・I/O障害は例外にする。 */
  async readSnapshot(filename: string): Promise<Session | null> {
    let raw: string;
    try {
      const metadata = await lstat(filename);
      if (!metadata.isFile()) throw new StoreError('INVALID_DATA', 'Stored session must be a regular file.');
      if (metadata.size > MAX_SNAPSHOT_BYTES) throw new StoreError('INVALID_DATA', 'Stored session exceeds 1 MiB.');
      raw = await readFile(filename, 'utf8');
    } catch (error) {
      if (systemErrorCode(error) === 'ENOENT') return null;
      throw error;
    }
    const session = parseSnapshot(raw);
    if (this.filename(session.sessionId) !== filename)
      throw new StoreError('INVALID_DATA', 'Stored session ID does not match its filename.');
    return session;
  }

  /** 呼び出し側が同じファイルのロックを保持する。保存の失敗は呼び出し側へ伝播する。 */
  async writeSnapshot(filename: string, session: Session): Promise<void> {
    await writeFileAtomically(filename, serializeSnapshot(session));
  }

  /**
   * 取得できなければ待機せずSESSION_BUSYを返し、他のI/O障害はそのまま伝える。
   * プロセスが残っている可能性があるため、既存ロックを自動削除しない。
   * actionの成功・失敗にかかわらず、自分が取得したロックを解放する。
   */
  async withLock<T>(filename: string, action: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = `${filename}.lock`;
    const lock = await fs.open(lockPath, 'wx', 0o600).catch((error) => {
      if (systemErrorCode(error) === 'EEXIST')
        throw new StoreError('SESSION_BUSY', `The session lock already exists: ${lockPath}.`);
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
}
