import { StoreError, systemErrorCode } from './errors.js';
import type { CleanupResult } from './schema.js';
import type { SnapshotFile, SnapshotFiles } from './snapshot-files.js';

/**
 * 明示操作として完了記録済みセッションだけを回収する。各候補のロックは順に取得する。
 * 保存と異なり回収は失敗しても続行し、見送ったファイルと理由を次回の再試行用に返す。
 */
export async function collectCompleted(files: SnapshotFiles): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: 0, skipped: [] };
  const skip = (file: string, error: unknown) => {
    const code = error instanceof StoreError ? error.code : (systemErrorCode(error) ?? 'CLEANUP_FAILED');
    result.skipped.push({ file, code });
  };
  let entries: SnapshotFile[];
  try {
    entries = await files.listSnapshots();
  } catch (error) {
    if (systemErrorCode(error) === 'ENOENT') return result;
    skip('.', error);
    return result;
  }
  for (const { name, filename } of entries) {
    try {
      await files.withLock(filename, async () => {
        // 保存・初期化・完了と同じロック内で読み直し、列挙後の古い状態から削除しない。
        const session = await files.readSnapshot(filename);
        if (session?.completedAt != null) {
          await files.deleteSnapshot(filename);
          result.deleted++;
        }
      });
    } catch (error) {
      skip(name, error);
    }
  }
  return result;
}
