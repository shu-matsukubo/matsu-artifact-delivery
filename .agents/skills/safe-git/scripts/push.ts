import { lstatSync, realpathSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runProcess } from './process.ts';

type Options = { branch: string; dryRun: boolean };
type Run = (args: string[], cwd: string, sshTransport?: boolean) => string | Promise<string>;
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

function trustedExecutable(name: 'Git' | 'SSH' | 'Shell') {
  // OS 管理の固定配置を使い、PATH や環境変数から実行ファイルを選ばない。
  const path =
    process.platform === 'win32'
      ? name === 'Git'
        ? 'C:/Program Files/Git/cmd/git.exe'
        : name === 'SSH'
          ? 'C:/Program Files/Git/usr/bin/ssh.exe'
          : 'C:/Program Files/Git/usr/bin/sh.exe'
      : process.platform === 'linux' || process.platform === 'darwin'
        ? name === 'Git'
          ? '/usr/bin/git'
          : name === 'SSH'
            ? '/usr/bin/ssh'
            : undefined
        : undefined;
  if (!path) throw new Error(`この OS の信頼する ${name} 実行ファイルが定義されていません。`);
  const executable = realpathSync(path);
  const normalize = (value: string) => (process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value));
  if (normalize(executable) !== normalize(path) || !lstatSync(executable).isFile())
    throw new Error(`信頼する ${name} 実行ファイルの配置が不正です。`);
  if (process.platform !== 'win32') {
    for (let entry = executable; ; entry = dirname(entry)) {
      const stat = lstatSync(entry);
      if (stat.uid !== 0 || (stat.mode & 0o022) !== 0)
        throw new Error(
          `${name} 実行ファイルと親ディレクトリは root 所有で、group / other の書き込みを禁止してください。`,
        );
      if (dirname(entry) === entry) break;
    }
  }
  return executable;
}

export async function runGit(args: string[], cwd: string, sshTransport = false, execute = runProcess) {
  // Git の探索先・設定を環境変数で差し替えない。認証用変数は維持する。
  if (
    Object.keys(process.env).some((key) =>
      /^(?:GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG(?:_.*)?|NAMESPACE|REPLACE_REF_BASE|SHALLOW_FILE|EXEC_PATH|SSH(?:_COMMAND|_VARIANT)?|SSL_(?:NO_VERIFY|CAINFO|CAPATH)|PROXY_SSL_CAINFO)|SSL_CERT_(?:FILE|DIR)|CURL_CA_BUNDLE)$/i.test(
        key,
      ),
    )
  )
    throw new Error('Git の実行先・設定を上書きする環境変数が設定されています。');
  try {
    const executable = trustedExecutable('Git');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: '0',
      GIT_ASKPASS: '',
      SSH_ASKPASS: '',
      SSH_ASKPASS_REQUIRE: 'never',
      ...(sshTransport
        ? {
            GIT_SSH_COMMAND: `"${trustedExecutable('SSH').replaceAll('\\', '/')}" -F none -o BatchMode=yes -o Hostname=github.com -o Port=22 -o ProxyCommand=none -o ProxyJump=none -o StrictHostKeyChecking=yes`,
          }
        : {}),
    };
    if (sshTransport && process.platform === 'win32') {
      // GIT_SSH_COMMAND を解釈する Git for Windows の sh も固定配置から選ぶ。
      const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
      const inheritedPath = pathKey ? env[pathKey] : '';
      if (pathKey) delete env[pathKey];
      env.PATH = dirname(trustedExecutable('Shell')) + delimiter + (inheritedPath ?? '');
    }
    const tls =
      process.platform === 'win32' ? ['-c', 'http.sslBackend=schannel', '-c', 'http.schannelUseSSLCAInfo=false'] : [];
    return await execute(executable, ['-c', 'core.askPass=', '-c', 'credential.interactive=false', ...tls, ...args], {
      cwd,
      env,
      timeout: 60_000,
    });
  } catch (error) {
    throw new Error('Git の検証または Push に失敗しました。状態を確認してから再実行してください。', { cause: error });
  }
}

export async function safePush(options: Options, root = repository, run: Run = runGit) {
  checkBranch(options.branch);
  const git = async (...args: string[]) => (await run(args, root)).trim();
  if (realpathSync(await git('rev-parse', '--show-toplevel')) !== realpathSync(root))
    throw new Error('スクリプトと Git リポジトリのルートが一致しません。');
  const grafts = await git('rev-parse', '--path-format=absolute', '--git-path', 'info/grafts');
  if (lstatSync(grafts, { throwIfNoEntry: false })) throw new Error('info/grafts が存在するため Push できません。');
  if ((await git('symbolic-ref', '--quiet', '--short', 'HEAD')) !== options.branch)
    throw new Error('現在のブランチと --branch が一致しません。');
  if ((await git('ls-files', '-v', '-z')).split('\0').some((entry) => /^[Ss] /.test(entry)))
    throw new Error('skip-worktree の索引フラグがあるため作業ツリーを検証できません。');
  try {
    await git('-c', 'core.fsmonitor=false', 'update-index', '--really-refresh');
  } catch (error) {
    throw new Error('レビュー済みの変更をコミットし、作業ツリーを clean にしてください。', { cause: error });
  }
  if (await git('-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '--untracked-files=all'))
    throw new Error('レビュー済みの変更をコミットし、作業ツリーを clean にしてください。');
  const commit = await git('rev-parse', '--verify', 'HEAD^{commit}');
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('HEAD の commit SHA を確認できません。');
  const fetchUrl = await git('remote', 'get-url', '--all', 'origin');
  const pushUrl = await git('remote', 'get-url', '--push', '--all', 'origin');
  if (!approvedUrls.has(fetchUrl) || !approvedUrls.has(pushUrl))
    throw new Error('origin の取得先・Push 先は対象 GitHub リポジトリの単一 URL に限定します。');
  const sshTransport = [fetchUrl, pushUrl].some((url) => url.startsWith('git@') || url.startsWith('ssh://'));
  for (const key of (await git('config', '--name-only', '--list')).split('\n')) {
    if (
      key.toLowerCase().startsWith('url.') ||
      /^http(?:\..+)?\.sslverify$/i.test(key) ||
      (sshTransport && key.toLowerCase() === 'core.sshcommand')
    )
      throw new Error('URL・TLS 検証・SSH コマンドの設定が上書きされているため Push できません。');
    if (!/^http(?:\..+)?\.(?:sslcainfo|sslcapath|proxysslcainfo)$/i.test(key)) continue;
    // Git for Windows 同梱 CA の system 設定だけを許可する。ユーザー・リポジトリの指定は拒否する。
    let bundledCA = false;
    if (process.platform === 'win32' && key.toLowerCase() === 'http.sslcainfo') {
      const entries = (
        await git('config', '--null', '--show-origin', '--show-scope', '--get-all', 'http.sslcainfo')
      ).split('\0');
      if (entries.at(-1) === '') entries.pop();
      const configFile = 'C:/Program Files/Git/etc/gitconfig';
      const bundle = entries[2] ?? '';
      const bundles = ['ucrt64', 'mingw64'].map(
        (layout) => `C:/Program Files/Git/${layout}/etc/ssl/certs/ca-bundle.crt`,
      );
      const normalize = (value: string) => value.replaceAll('\\', '/').toLowerCase();
      bundledCA =
        bundles.some((path) => normalize(path) === normalize(bundle)) &&
        entries.length > 0 &&
        entries.length % 3 === 0 &&
        entries.every(
          (value, index) => normalize(value) === normalize(['system', 'file:' + configFile, bundle][index % 3]!),
        ) &&
        normalize(realpathSync(configFile)) === normalize(configFile) &&
        normalize(realpathSync(bundle)) === normalize(bundle) &&
        lstatSync(bundle).isFile();
    }
    if (!bundledCA) throw new Error('独自 CA の設定があるため Push できません。');
  }
  const remoteGit = async (...args: string[]) => (await run(args, root, sshTransport)).trim();
  const refs = await remoteGit('ls-remote', '--symref', pushUrl, 'HEAD', 'refs/heads/' + options.branch);
  const defaultBranch = /^ref: refs\/heads\/([^\s]+)\tHEAD$/m.exec(refs)?.[1];
  if (!defaultBranch || defaultBranch.toLowerCase() === options.branch.toLowerCase())
    throw new Error('default branch を確認できない、または Push 先が default branch です。');
  const remoteLine = refs.split('\n').find((line) => line.endsWith('\trefs/heads/' + options.branch));
  let expectedRemoteCommit = '';
  if (remoteLine) {
    const remoteCommit = remoteLine.split('\t')[0]!;
    if (!/^[a-f0-9]{40,64}$/.test(remoteCommit)) throw new Error('リモートの commit SHA が不正です。');
    await git('--no-replace-objects', 'merge-base', '--is-ancestor', remoteCommit, commit);
    expectedRemoteCommit = remoteCommit;
  }
  const plan = { remote: 'origin', url: pushUrl, branch: options.branch, commit };
  if (!options.dryRun) {
    // 検証後に先端が変わった場合は拒否する。URL と単一 refspec を明示する。
    await remoteGit(
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
    const plan = await safePush(options);
    console.log(JSON.stringify({ ...plan, dryRun: options.dryRun }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
