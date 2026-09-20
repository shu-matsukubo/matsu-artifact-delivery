import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { StoreError } from './errors.js';

/** 起動時に保存先を解決する。作業ディレクトリに依存する相対パスは受け付けない。 */
export function dataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const directory =
    env.ARTIFACT_WORKFLOW_DATA_DIR ??
    (env.PLUGIN_DATA ? join(env.PLUGIN_DATA, 'task-memory') : join(tmpdir(), 'matsu-artifact-workflow', 'task-memory'));
  if (!isAbsolute(directory)) throw new StoreError('INVALID_DIRECTORY', 'The data directory must be an absolute path.');
  return resolve(directory);
}
