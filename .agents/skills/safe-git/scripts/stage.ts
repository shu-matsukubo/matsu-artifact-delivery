import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkedConfigKeys, runGit } from './push.ts';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

// レビュー済みのパスを literal path として受け取り、filter と hook を実行しない。
export async function stageFiles(args: string[], root = repository, run = runGit) {
  if (args[0] !== '--' || args.length < 2 || args.slice(1).some((path) => !path || path.includes('\0')))
    throw new Error('引数は -- <レビュー済みパス>... のみです。');
  const paths = args.slice(1);
  const directories: string[] = [];
  for (const path of paths) {
    const fullPath = resolve(root, path);
    const fromRoot = relative(root, fullPath);
    if (
      isAbsolute(path) ||
      isAbsolute(fromRoot) ||
      !fromRoot ||
      fromRoot === '..' ||
      fromRoot.startsWith('..\\') ||
      fromRoot.startsWith('../')
    )
      throw new Error('リポジトリ内の個別ファイルを相対パスで指定してください。');
    if (lstatSync(fullPath, { throwIfNoEntry: false })?.isDirectory()) directories.push(fromRoot.split(sep).join('/'));
  }
  if (realpathSync((await run(['rev-parse', '--show-toplevel'], root)).replace(/\r?\n$/, '')) !== realpathSync(root))
    throw new Error('スクリプトと Git リポジトリのルートが一致しません。');
  await checkedConfigKeys(root, run, paths);
  if (directories.length) {
    const entries = (await run(['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...directories], root)).split(
      '\0',
    );
    const gitlinks = new Set(entries.flatMap((entry) => /^160000 [a-f0-9]{40,64} 0\t(.+)$/s.exec(entry)?.[1] ?? []));
    if (directories.some((path) => !gitlinks.has(path)))
      throw new Error('ディレクトリは追跡済み submodule だけを指定できます。');
  }
  await run(['--literal-pathspecs', '-c', 'core.hooksPath=/dev/null', 'add', '--', ...paths], root);
  return { paths };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (realpathSync(process.cwd()) !== realpathSync(repository))
      throw new Error('リポジトリルートから実行してください。');
    console.log(JSON.stringify(await stageFiles(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
