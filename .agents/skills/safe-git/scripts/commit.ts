import { lstatSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkedConfigKeys, runGit } from './push.ts';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

// ステージ済みの内容から新規コミットだけを作り、履歴を書き換える引数は受け取らない。
export async function createCommit(args: string[], root = repository, run = runGit) {
  if (args.length !== 2 || args[0] !== '--message' || !args[1]?.trim() || args[1].includes('\0'))
    throw new Error('引数は --message <コミットメッセージ> のみです。');
  if (realpathSync((await run(['rev-parse', '--show-toplevel'], root)).replace(/\r?\n$/, '')) !== realpathSync(root))
    throw new Error('スクリプトと Git リポジトリのルートが一致しません。');
  const gitDir = (await run(['rev-parse', '--absolute-git-dir'], root)).replace(/\r?\n$/, '');
  for (const state of [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'REBASE_HEAD',
    'sequencer',
    'rebase-apply',
    'rebase-merge',
  ]) {
    if (lstatSync(resolve(gitDir, state), { throwIfNoEntry: false }))
      throw new Error('履歴操作の途中です。人間が進行中の操作を確認してください。');
  }
  await checkedConfigKeys(root, run);
  await run(['-c', 'core.hooksPath=/dev/null', 'commit', '--no-gpg-sign', '--message=' + args[1]], root);
  return { commit: (await run(['rev-parse', '--verify', 'HEAD^{commit}'], root)).replace(/\r?\n$/, '') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (realpathSync(process.cwd()) !== realpathSync(repository))
      throw new Error('リポジトリルートから実行してください。');
    console.log(JSON.stringify(await createCommit(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
