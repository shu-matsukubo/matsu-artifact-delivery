import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkedConfigKeys, runGit } from './push.ts';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

// 既存の配置・ref に触れず、明示した commit の detached checkout だけを作る。
export async function createWorktree(args: string[], root = repository, run = runGit) {
  if (
    args.length !== 4 ||
    args[0] !== '--path' ||
    args[2] !== '--commit' ||
    !isAbsolute(args[1]!) ||
    !/^[a-f0-9]{40,64}$/.test(args[3]!)
  )
    throw new Error('引数は --path <新規作業ツリーの絶対パス> --commit <commit SHA> のみです。');
  const commit = args[3]!;
  const path = resolve(args[1]!);
  const parent = realpathSync(dirname(path));
  if (resolve(parent, basename(path)) !== path || lstatSync(path, { throwIfNoEntry: false }))
    throw new Error('作業ツリーには symlink を経由しない未使用の配置先を指定してください。');
  if (realpathSync((await run(['rev-parse', '--show-toplevel'], root)).replace(/\r?\n$/, '')) !== realpathSync(root))
    throw new Error('スクリプトと Git リポジトリのルートが一致しません。');
  await checkedConfigKeys(root, run);
  const commonDir = (await run(['rev-parse', '--path-format=absolute', '--git-common-dir'], root)).replace(
    /\r?\n$/,
    '',
  );
  const worktrees = (await run(['worktree', 'list', '--porcelain', '-z'], root))
    .split('\0')
    .flatMap((field) => (field.startsWith('worktree ') ? [field.slice(9)] : []));
  for (const existing of [root, commonDir, ...worktrees]) {
    const existingPath = lstatSync(existing, { throwIfNoEntry: false }) ? realpathSync(existing) : resolve(existing);
    const fromExisting = relative(existingPath, path);
    if (!fromExisting || (!isAbsolute(fromExisting) && fromExisting !== '..' && !fromExisting.startsWith('..' + sep)))
      throw new Error('作業ツリーは既存の作業ツリー・Git ディレクトリの外に新規作成してください。');
  }
  if ((await run(['rev-parse', '--verify', commit + '^{commit}'], root)).replace(/\r?\n$/, '') !== commit)
    throw new Error('指定 SHA がローカルの commit と一致しません。');
  // 新しい checkout が読む属性を検査し、smudge / process の外部実行も防ぐ。
  await checkedConfigKeys(root, run, [], commit);
  // 検証中に配置先が作られていても、既存の空ディレクトリを再利用しない。
  mkdirSync(path, { mode: 0o700 });
  await run(['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', '--', path, commit], root);
  return { path, commit };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (realpathSync(process.cwd()) !== realpathSync(repository))
      throw new Error('リポジトリルートから実行してください。');
    console.log(JSON.stringify(await createWorktree(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
