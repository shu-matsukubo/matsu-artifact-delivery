import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkedConfigKeys, parseArguments, runGit } from './push.ts';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

// 任意の Git オプション・基点を受け取らず、現在の HEAD から新規作成だけを行う。
export async function createBranch(args: string[], root = repository, run = runGit) {
  if (args.length !== 2 || args[0] !== '--branch') throw new Error('引数は --branch <新規作業ブランチ> のみです。');
  const { branch } = parseArguments(args);
  if (realpathSync(await run(['rev-parse', '--show-toplevel'], root)) !== realpathSync(root))
    throw new Error('スクリプトと Git リポジトリのルートが一致しません。');
  await checkedConfigKeys(root, run);
  await run(
    [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=/dev/null',
      'switch',
      '--no-overwrite-ignore',
      '--no-guess',
      '-c',
      branch,
    ],
    root,
  );
  return { branch };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (realpathSync(process.cwd()) !== realpathSync(repository))
      throw new Error('リポジトリルートから実行してください。');
    console.log(JSON.stringify(await createBranch(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
