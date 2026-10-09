import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Options = { branch: string; dryRun: boolean };
type Run = (args: string[], cwd: string) => string;
const repository = fileURLToPath(new URL('../../../../', import.meta.url));
const approvedUrls = new Set([
  'https://github.com/shu-matsukubo/matsu-artifact-delivery',
  'https://github.com/shu-matsukubo/matsu-artifact-delivery.git',
  'git@github.com:shu-matsukubo/matsu-artifact-delivery.git',
  'ssh://git@github.com/shu-matsukubo/matsu-artifact-delivery.git',
]);

function checkBranch(branch: string) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock')) ||
    /^(?:main|master|develop|development|release|releases|prod|production|stable)(?:\/|$)/i.test(branch) ||
    branch === 'HEAD'
  )
    throw new Error('作業ブランチ名が不正、または保護対象です。');
}

export function parseArguments(args: string[]): Options {
  let branch: string | undefined;
  let dryRun = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--branch' && branch === undefined) branch = args[++index];
    else if (arg === '--dry-run' && !dryRun) dryRun = true;
    else throw new Error('引数は --branch <作業ブランチ> と任意の --dry-run のみです。');
  }
  if (!branch) throw new Error('--branch <作業ブランチ> が必要です。');
  checkBranch(branch);
  return { branch, dryRun };
}

function trustedGit() {
  // OS 管理の固定配置を使い、PATH や環境変数から実行ファイルを選ばない。
  const path =
    process.platform === 'win32'
      ? 'C:/Program Files/Git/cmd/git.exe'
      : process.platform === 'linux' || process.platform === 'darwin'
        ? '/usr/bin/git'
        : undefined;
  if (!path) throw new Error('この OS の信頼する Git 実行ファイルが定義されていません。');
  const executable = realpathSync(path);
  const normalize = (value: string) => (process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value));
  if (normalize(executable) !== normalize(path) || !lstatSync(executable).isFile())
    throw new Error('信頼する Git 実行ファイルの配置が不正です。');
  if (process.platform !== 'win32') {
    for (let entry = executable; ; entry = dirname(entry)) {
      const stat = lstatSync(entry);
      if (stat.uid !== 0 || (stat.mode & 0o022) !== 0)
        throw new Error('Git 実行ファイルと親ディレクトリは root 所有で、group / other の書き込みを禁止してください。');
      if (dirname(entry) === entry) break;
    }
  }
  return executable;
}

const runGit: Run = (args, cwd) => {
  // Git の探索先・設定を環境変数で差し替えない。認証用変数は維持する。
  if (
    Object.keys(process.env).some((key) =>
      /^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG(?:_.*)?|NAMESPACE|REPLACE_REF_BASE|SHALLOW_FILE|EXEC_PATH|SSH(?:_COMMAND|_VARIANT)?)$/i.test(
        key,
      ),
    )
  )
    throw new Error('Git の実行先・設定を上書きする環境変数が設定されています。');
  try {
    return execFileSync(trustedGit(), args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();
  } catch (error) {
    throw new Error('Git の検証または Push に失敗しました。状態を確認してから再実行してください。', { cause: error });
  }
};

export function safePush(options: Options, root = repository, run: Run = runGit) {
  checkBranch(options.branch);
  const git = (...args: string[]) => run(args, root).trim();
  if (realpathSync(git('rev-parse', '--show-toplevel')) !== realpathSync(root))
    throw new Error('スクリプトと Git リポジトリのルートが一致しません。');
  const grafts = git('rev-parse', '--path-format=absolute', '--git-path', 'info/grafts');
  if (lstatSync(grafts, { throwIfNoEntry: false })) throw new Error('info/grafts が存在するため Push できません。');
  if (git('symbolic-ref', '--quiet', '--short', 'HEAD') !== options.branch)
    throw new Error('現在のブランチと --branch が一致しません。');
  if (git('status', '--porcelain=v1', '--untracked-files=all'))
    throw new Error('レビュー済みの変更をコミットし、作業ツリーを clean にしてください。');
  const commit = git('rev-parse', '--verify', 'HEAD^{commit}');
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('HEAD の commit SHA を確認できません。');
  const fetchUrl = git('remote', 'get-url', '--all', 'origin');
  const pushUrl = git('remote', 'get-url', '--push', '--all', 'origin');
  if (!approvedUrls.has(fetchUrl) || !approvedUrls.has(pushUrl))
    throw new Error('origin の取得先・Push 先は対象 GitHub リポジトリの単一 URL に限定します。');
  const sshTransport = [fetchUrl, pushUrl].some((url) => url.startsWith('git@') || url.startsWith('ssh://'));
  if (
    git('config', '--name-only', '--list')
      .split('\n')
      .some((key) => key.toLowerCase().startsWith('url.') || (sshTransport && key.toLowerCase() === 'core.sshcommand'))
  )
    throw new Error('URL の書き換え設定または SSH コマンドの上書きがあるため Push できません。');
  const refs = git('ls-remote', '--symref', pushUrl, 'HEAD', 'refs/heads/' + options.branch);
  const defaultBranch = /^ref: refs\/heads\/([^\s]+)\tHEAD$/m.exec(refs)?.[1];
  if (!defaultBranch || defaultBranch.toLowerCase() === options.branch.toLowerCase())
    throw new Error('default branch を確認できない、または Push 先が default branch です。');
  const remoteLine = refs.split('\n').find((line) => line.endsWith('\trefs/heads/' + options.branch));
  let expectedRemoteCommit = '';
  if (remoteLine) {
    const remoteCommit = remoteLine.split('\t')[0]!;
    if (!/^[a-f0-9]{40,64}$/.test(remoteCommit)) throw new Error('リモートの commit SHA が不正です。');
    git('--no-replace-objects', 'merge-base', '--is-ancestor', remoteCommit, commit);
    expectedRemoteCommit = remoteCommit;
  }
  const plan = { remote: 'origin', url: pushUrl, branch: options.branch, commit };
  if (!options.dryRun) {
    // 検証後に先端が変わった場合は拒否する。URL と単一 refspec を明示する。
    git(
      '-c',
      'push.gpgSign=false',
      'push',
      '--porcelain',
      '--no-verify',
      '--no-follow-tags',
      '--recurse-submodules=no',
      '--force-with-lease=refs/heads/' + options.branch + ':' + expectedRemoteCommit,
      '--',
      pushUrl,
      commit + ':refs/heads/' + options.branch,
    );
  }
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (realpathSync(process.cwd()) !== realpathSync(repository))
      throw new Error('リポジトリルートから実行してください。');
    const plan = safePush(options);
    console.log(JSON.stringify({ ...plan, dryRun: options.dryRun }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
