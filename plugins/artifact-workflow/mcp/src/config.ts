import { homedir, tmpdir } from 'node:os';
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

/** 登録指示は計画の回収・削除から独立したユーザー状態ディレクトリへ保存する。 */
export function extensionsDirectory(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ARTIFACT_WORKFLOW_EXTENSIONS_DIR) {
    if (!isAbsolute(env.ARTIFACT_WORKFLOW_EXTENSIONS_DIR))
      throw new StoreError('INVALID_DIRECTORY', 'The extensions directory must be an absolute path.');
    return resolve(env.ARTIFACT_WORKFLOW_EXTENSIONS_DIR);
  }
  if (env.PLUGIN_DATA) {
    if (!isAbsolute(env.PLUGIN_DATA))
      throw new StoreError('INVALID_DIRECTORY', 'PLUGIN_DATA must be an absolute path.');
    return resolve(join(env.PLUGIN_DATA, 'extensions'));
  }
  const base = env.XDG_STATE_HOME ?? (process.platform === 'win32' ? env.LOCALAPPDATA : undefined);
  if (base) {
    if (!isAbsolute(base))
      throw new StoreError('INVALID_DIRECTORY', 'The user state directory must be an absolute path.');
    return resolve(join(base, 'matsu-artifact-workflow', 'extensions'));
  }
  if (process.platform === 'darwin')
    return resolve(join(homedir(), 'Library', 'Application Support', 'matsu-artifact-workflow', 'extensions'));
  if (process.platform === 'win32')
    return resolve(join(homedir(), 'AppData', 'Local', 'matsu-artifact-workflow', 'extensions'));
  return resolve(join(homedir(), '.local', 'state', 'matsu-artifact-workflow', 'extensions'));
}
