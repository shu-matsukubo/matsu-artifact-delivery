import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkedConfigKeys, checkedRemote, runGit } from './push.ts';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

export async function fetchCommit(
  args: string[],
  root = repository,
  run: (args: string[], cwd: string, sshTransport?: boolean) => string | Promise<string> = runGit,
) {
  if (args.length !== 2 || args[0] !== '--commit' || !/^[a-f0-9]{40,64}$/.test(args[1]!))
    throw new Error('引数は --commit <取得する commit SHA> のみです。');
  const commit = args[1]!;
  if (realpathSync((await run(['rev-parse', '--show-toplevel'], root)).replace(/\r?\n$/, '')) !== realpathSync(root))
    throw new Error('スクリプトと Git リポジトリのルートが一致しません。');
  const configKeys = await checkedConfigKeys(root, run);
  if (configKeys.some((key) => /^fetch\.bundleuri$/i.test(key)))
    throw new Error('追加の取得先となる bundleURI が設定されているため Fetch できません。');
  const remote = await checkedRemote(root, configKeys, run, 'fetch');
  // 宛先 ref を指定せず、既存の ref・FETCH_HEAD・作業内容を保全する。
  await remote.run(
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'fetch.followRemoteHEAD=never',
    'fetch',
    '--no-tags',
    '--no-prune',
    '--no-prune-tags',
    '--refmap=',
    '--no-write-fetch-head',
    '--recurse-submodules=no',
    '--no-auto-maintenance',
    '--no-write-commit-graph',
    '--',
    remote.url,
    commit,
  );
  if ((await run(['rev-parse', '--verify', commit + '^{commit}'], root)).replace(/\r?\n$/, '') !== commit)
    throw new Error('取得した object が指定 commit と一致しません。');
  return { url: remote.url, commit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (realpathSync(process.cwd()) !== realpathSync(repository))
      throw new Error('リポジトリルートから実行してください。');
    console.log(JSON.stringify(await fetchCommit(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
