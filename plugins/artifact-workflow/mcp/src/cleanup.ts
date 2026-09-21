import { StoreError, systemErrorCode } from './errors.js';
import type { CleanupResult } from './schema.js';
import type { SnapshotFile, SnapshotFiles } from './snapshot-files.js';

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
  let entries: SnapshotFile[];
  try {
    entries = await files.listSnapshots();
  } catch (error) {
    skip('.', error);
    return result;
  }
  for (const { name, filename } of entries) {
    if (filename === currentFilename) continue;
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
