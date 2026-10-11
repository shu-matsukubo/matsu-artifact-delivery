import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkedConfigKeys, runGit } from './push.ts';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const flags: Record<string, string[]> = {
  status: [
    '--short',
    '-s',
    '--branch',
    '-b',
    '--porcelain',
    '--porcelain=v1',
    '--porcelain=v2',
    '--untracked-files=all',
    '--ignore-submodules=none',
  ],
  diff: [
    '--stat',
    '--check',
    '--cached',
    '--staged',
    '--name-only',
    '--name-status',
    '--numstat',
    '--quiet',
    '--exit-code',
    '--no-renames',
  ],
  log: ['--oneline', '--all', '--graph', '--decorate', '--stat', '--name-only'],
  show: ['--stat', '--name-only', '--name-status', '--no-patch'],
  'for-each-ref': [],
  'rev-parse': [
    '--verify',
    '--short',
    '--show-toplevel',
    '--absolute-git-dir',
    '--git-common-dir',
    '--git-path',
    '--path-format=absolute',
  ],
  'ls-files': ['--stage', '-s', '-v', '-z', '--cached', '--others', '--exclude-standard'],
  'ls-tree': ['-r', '-z', '--name-only', '--full-tree'],
  'merge-base': ['--is-ancestor'],
};

export async function inspectRepository(args: string[], root = repository, run = runGit) {
  if (!args.length || args.some((arg) => !arg || arg.includes('\0'))) throw new Error('読み取りコマンドが必要です。');
  const command = args[0]!;
  const rest = args.slice(1);
  let permitted = Object.hasOwn(flags, command) ? flags[command] : undefined;
  let operands = rest;
  if (command === 'notes') {
    let offset = 0;
    if (rest[0] === '--ref') {
      if (!rest[1] || rest[1].startsWith('-')) throw new Error('notes の ref が不正です。');
      offset = 2;
    } else if (rest[0]?.startsWith('--ref=')) {
      if (rest[0] === '--ref=') throw new Error('notes の ref が不正です。');
      offset = 1;
    }
    if (rest[offset] && !['list', 'show', 'get-ref'].includes(rest[offset]!))
      throw new Error('notes は一覧・表示だけを実行できます。');
    permitted = [];
    operands = rest.slice(offset + 1);
  } else if (command === 'remote') {
    if (rest.length && !['-v', '--verbose', 'get-url'].includes(rest[0]!))
      throw new Error('remote は一覧・URL の表示だけを実行できます。');
    permitted = rest[0] === 'get-url' ? ['--all', '--push'] : [];
    operands = rest.slice(1);
    if ((rest[0] === '-v' || rest[0] === '--verbose') && operands.length)
      throw new Error('remote の追加サブコマンドは受け付けません。');
  } else if (command === 'worktree') {
    if (rest[0] !== 'list') throw new Error('worktree は一覧だけを実行できます。');
    permitted = ['--porcelain', '-z'];
    operands = rest.slice(1);
  } else if (command === 'reflog' || command === 'refs') {
    const implicitShow = command === 'reflog' && (!rest.length || rest[0] === '--all');
    if (!implicitShow && !['list', 'show', 'exists', ...(command === 'refs' ? ['verify'] : [])].includes(rest[0]!))
      throw new Error('ref は一覧・表示・検証だけを実行できます。');
    permitted = command === 'reflog' ? ['--all'] : [];
    operands = implicitShow ? rest : rest.slice(1);
  } else if (command === 'config') {
    if (!['--get', '--get-all', '--get-urlmatch', '--list'].includes(rest[0]!))
      throw new Error('config は設定値の参照だけを実行できます。');
    permitted = ['--name-only', '--show-origin', '--show-scope', '--null', '--type=bool'];
    operands = rest.slice(1);
  }
  if (!permitted) throw new Error('この読み取りコマンドは定義されていません。');
  let paths = false;
  for (const arg of operands) {
    if (arg === '--' && ['diff', 'log', 'show', 'ls-files', 'ls-tree'].includes(command)) {
      paths = true;
      continue;
    }
    if (paths || !arg.startsWith('-') || permitted.includes(arg)) continue;
    if (['log', 'show', 'for-each-ref'].includes(command) && /^--format=/.test(arg)) continue;
    if (command === 'log' && /^--max-count=[1-9][0-9]*$/.test(arg)) continue;
    throw new Error('読み取り用に定義したオプションだけを指定してください。');
  }
  if (realpathSync((await run(['rev-parse', '--show-toplevel'], root)).replace(/\r?\n$/, '')) !== realpathSync(root))
    throw new Error('Git リポジトリのルートが一致しません。');
  await checkedConfigKeys(root, run);
  return run(
    [
      '--no-pager',
      '-c',
      'core.hooksPath=/dev/null',
      command,
      ...(['diff', 'log', 'show'].includes(command) ? ['--no-ext-diff', '--no-textconv'] : []),
      ...rest,
    ],
    root,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    let root = repository;
    if (args[0] === '--cwd') {
      if (!args[1] || !isAbsolute(args[1])) throw new Error('--cwd にはリポジトリの絶対パスを指定してください。');
      root = args[1];
      args.splice(0, 2);
    }
    process.stdout.write(await inspectRepository(args, root));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
