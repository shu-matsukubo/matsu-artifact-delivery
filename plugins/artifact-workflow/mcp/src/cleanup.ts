import fs from 'node:fs/promises';
import { join } from 'node:path';
import { StoreError, systemErrorCode } from './errors.js';
import type { CleanupResult } from './schema.js';
import type { SnapshotFiles } from './snapshot-files.js';

/**
 * 明示的に完了した別セッションだけを回収する。呼び出し元は自分のロックを先に解放する。
 * 保存と異なり回収は失敗しても続行し、見送ったファイルと理由を次回の再試行用に返す。
 */
export async function collectCompleted(files: SnapshotFiles, currentFilename: string): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: 0, skipped: [] };
  const skip = (file: string, error: unknown) => {
    const code = error instanceof StoreError ? error.code : (systemErrorCode(error) ?? 'CLEANUP_FAILED');
    result.skipped.push({ file, code });
  };
  let entries: string[];
  try {
    entries = await fs.readdir(files.directory);
  } catch (error) {
    skip('.', error);
    return result;
  }
  for (const file of entries) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    const filename = join(files.directory, file);
    if (filename === currentFilename) continue;
    try {
      await files.withLock(filename, async () => {
        // 保存・初期化・完了と同じロック内で読み直し、列挙後の古い状態から削除しない。
        const session = await files.readSnapshot(filename);
        if (session?.completedAt != null) {
          await fs.unlink(filename);
          result.deleted++;
        }
      });
    } catch (error) {
      skip(file, error);
    }
  }
  return result;
}
