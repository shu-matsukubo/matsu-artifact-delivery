import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { delimiter, dirname, posix, resolve } from 'node:path';
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
  return trustedFile(path, name);
}

function trustedFile(path: string, name: string, allowProtectedSymlink = false) {
  const executable = realpathSync(path);
  const normalize = (value: string) => (process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value));
  if ((!allowProtectedSymlink && normalize(executable) !== normalize(path)) || !lstatSync(executable).isFile())
    throw new Error(`信頼する ${name} 実行ファイルの配置が不正です。`);
  if (allowProtectedSymlink) {
    const visited = new Set<string>();
    const check = (entry: string) => {
      if (visited.has(entry)) return;
      visited.add(entry);
      const stat = lstatSync(entry);
      if (stat.uid !== 0 || (!stat.isSymbolicLink() && (stat.mode & 0o022) !== 0))
        throw new Error(
          `${name} の symlink・実体・親ディレクトリは root 所有で、group / other の書き込みを禁止してください。`,
        );
      const parent = posix.dirname(entry);
      if (parent !== entry) check(parent);
      if (stat.isSymbolicLink()) check(posix.resolve(realpathSync(parent), readlinkSync(entry)));
    };
    check(path);
    check(executable);
    // multicall 実行ファイルは起動名で helper を選ぶため、固定の helper パスを維持する。
    return path;
  }
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
      /^(?:GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG(?:_.*)?|NAMESPACE|REPLACE_REF_BASE|SHALLOW_FILE|EXEC_PATH|ATTR_SOURCE|SSH(?:_COMMAND|_VARIANT)?|SSL_(?:NO_VERIFY|CAINFO|CAPATH)|PROXY_SSL_CAINFO)|SSL_CERT_(?:FILE|DIR)|CURL_CA_BUNDLE)$/i.test(
        key,
      ),
    )
  )
    throw new Error('Git の実行先・設定を上書きする環境変数が設定されています。');
  try {
    const executable = trustedExecutable('Git');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_NO_LAZY_FETCH: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
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
    for (const key of Object.keys(env)) {
      if (
        /^(?:LD_|DYLD_|_?RLD_|LDR_)/i.test(key) ||
        /^(?:NODE_OPTIONS|NODE_PATH|GLIBC_TUNABLES|BASH_ENV|ENV)$/i.test(key)
      )
        delete env[key];
    }
    if (process.platform === 'win32' && (sshTransport || args.includes('ls-remote') || args.includes('push'))) {
      // SSH コマンドと credential helper を解釈する sh も固定配置から選ぶ。
      const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path');
      const inheritedPath = pathKey ? env[pathKey] : '';
      if (pathKey) delete env[pathKey];
      env.PATH = dirname(trustedExecutable('Shell')) + delimiter + (inheritedPath ?? '');
    }
    const tls =
      process.platform === 'win32'
        ? [
            '-c',
            'http.sslBackend=schannel',
            '-c',
            'http.schannelUseSSLCAInfo=false',
            '-c',
            'http.schannelCheckRevoke=true',
          ]
        : [];
    return await execute(
      executable,
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.askPass=',
        '-c',
        'credential.interactive=false',
        ...(args.includes('ls-remote') || args.includes('push') ? ['-c', 'credential.helper='] : []),
        ...tls,
        ...args,
      ],
      {
        cwd,
        env,
        timeout: 60_000,
      },
    );
  } catch (error) {
    throw new Error('Git の検証または Push に失敗しました。状態を確認してから再実行してください。', { cause: error });
  }
}

// Git が作業ツリーを読む前に、属性から起動される外部コマンドを拒否する。
export async function checkedConfigKeys(root: string, run: Run = runGit, additionalPaths: string[] = []) {
  const git = async (...args: string[]) => (await run(args, root)).replace(/\r?\n$/, '');
  if (await git('for-each-ref', '--format=%(refname)', 'refs/replace/'))
    throw new Error('置換 ref が存在するため Git の状態を検証できません。');
  const configKeys = (await git('config', '--name-only', '--list')).split('\n');
  // 古い Git は GIT_NO_LAZY_FETCH を無視するため、partial clone の設定自体も拒否する。
  if (configKeys.some((key) => /^(?:extensions\.partialclone|remote\..+\.promisor)$/i.test(key)))
    throw new Error('partial clone の自動 fetch を伴うリポジトリは検証できません。');
  const filters = new Set(configKeys.flatMap((key) => /^filter\.(.+)\.(?:clean|process)$/i.exec(key)?.[1] ?? []));
  if (filters.size) {
    const paths = [
      ...new Set([
        ...(await git('-c', 'core.fsmonitor=false', 'ls-files', '-z')).split('\0').filter(Boolean),
        ...additionalPaths,
      ]),
    ];
    for (let offset = 0; offset < paths.length; offset += 100) {
      const attributes = (
        await git(
          '-c',
          'core.fsmonitor=false',
          'check-attr',
          '-z',
          'filter',
          '--',
          ...paths.slice(offset, offset + 100),
        )
      ).split('\0');
      for (let index = 2; index < attributes.length; index += 3) {
        if (filters.has(attributes[index]!))
          throw new Error('対象ファイルに実行可能な clean / process filter があるため Git 操作を実行できません。');
      }
    }
  }
  return configKeys;
}

async function credentialOptions(root: string, configKeys: string[], run: Run) {
  const keys = new Set(configKeys.filter((key) => /^credential(?:\..+)?\.helper$/i.test(key)));
  if (!keys.size) return [];
  // 継承した helper を先にリセットし、設定ファイルをまたぐ元の順序で再生する。
  const options = [...keys].flatMap((key) => ['-c', key + '=']);
  const entries = (await run(['config', '--null', '--list'], root)).split('\0');
  for (const entry of entries) {
    const separator = entry.indexOf('\n');
    const key = separator < 0 ? entry : entry.slice(0, separator);
    if (!/^credential(?:\..+)?\.helper$/i.test(key)) continue;
    if (separator < 0) throw new Error('credential helper の値が設定されていません。');
    const value = entry.slice(separator + 1);
    if (value === '') {
      options.push('-c', key + '=');
      continue;
    }
    const paths =
      process.platform === 'win32' && value === 'manager'
        ? ['ucrt64', 'mingw64'].map((layout) => `C:/Program Files/Git/${layout}/bin/git-credential-manager.exe`)
        : process.platform === 'linux' && (value === 'cache' || value === 'store')
          ? [`/usr/lib/git-core/git-credential-${value}`]
          : process.platform === 'darwin' && value === 'osxkeychain'
            ? [
                '/Library/Developer/CommandLineTools/usr/libexec/git-core/git-credential-osxkeychain',
                '/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core/git-credential-osxkeychain',
              ]
            : [];
    const path = paths.find((path) => lstatSync(path, { throwIfNoEntry: false }));
    if (!path) throw new Error('信頼する固定配置以外の credential helper は使用できません。');
    options.push(
      '-c',
      `${key}=!"${trustedFile(path, 'credential helper', process.platform === 'linux').replaceAll('\\', '/')}"`,
    );
  }
  return options;
}

// submodule にも同じ索引・内容・外部コマンドの検査を適用する。
async function checkedWorktree(root: string, run: Run, visited = new Set<string>()) {
  const git = async (...args: string[]) => (await run(args, root)).replace(/\r?\n$/, '');
  const canonicalRoot = realpathSync(root);
  if (visited.has(canonicalRoot)) throw new Error('submodule の作業ツリーが循環しています。');
  visited.add(canonicalRoot);
  const configKeys = await checkedConfigKeys(root, run);
  if (
    (await git('-c', 'core.fsmonitor=false', 'ls-files', '-v', '-z')).split('\0').some((entry) => /^[Ss] /.test(entry))
  )
    throw new Error('skip-worktree の索引フラグがあるため作業ツリーを検証できません。');
  const entries = (await git('-c', 'core.fsmonitor=false', 'ls-files', '--stage', '-z'))
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const match = /^(100644|100755|120000|160000) ([a-f0-9]{40,64}) 0\t(.+)$/s.exec(entry);
      if (!match) throw new Error('索引エントリーを検証できません。');
      return { mode: match[1]!, hash: match[2]!, path: match[3]! };
    });
  // 親の status も子の属性を読むため、初期化済みの子を先に検査する。
  for (const { mode, hash, path } of entries) {
    if (mode !== '160000') continue;
    const sub = resolve(root, path);
    if (!lstatSync(resolve(sub, '.git'), { throwIfNoEntry: false })) continue;
    if (realpathSync((await run(['rev-parse', '--show-toplevel'], sub)).replace(/\r?\n$/, '')) !== realpathSync(sub))
      throw new Error('submodule の Git リポジトリと作業ツリーが一致しません。');
    await checkedWorktree(sub, run, visited);
    if ((await run(['rev-parse', '--verify', 'HEAD^{commit}'], sub)).replace(/\r?\n$/, '') !== hash)
      throw new Error('レビュー済みの変更をコミットし、作業ツリーを clean にしてください。');
  }
  try {
    await git('-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', 'update-index', '--really-refresh');
  } catch (error) {
    throw new Error('レビュー済みの変更をコミットし、作業ツリーを clean にしてください。', { cause: error });
  }
  if (
    await git(
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.hooksPath=/dev/null',
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--ignore-submodules=none',
    )
  )
    throw new Error('レビュー済みの変更をコミットし、作業ツリーを clean にしてください。');
  // stat が一致しても内容を照合する。hash-object は改行変換などの Git 属性を適用する。
  const files: { path: string; hash: string }[] = [];
  for (const { mode, hash, path } of entries) {
    if (mode === '160000') continue;
    if (mode !== '120000') {
      files.push({ path, hash });
      continue;
    }
    const link = resolve(root, path);
    // core.symlinks=false の checkout ではリンク先文字列を通常ファイルに保存する。
    const content = lstatSync(link).isSymbolicLink() ? readlinkSync(link, { encoding: 'buffer' }) : readFileSync(link);
    const actual = createHash(hash.length === 40 ? 'sha1' : 'sha256')
      .update(`blob ${content.length}\0`)
      .update(content)
      .digest('hex');
    if (actual !== hash) throw new Error('レビュー済みの変更をコミットし、作業ツリーを clean にしてください。');
  }
  for (let offset = 0; offset < files.length; offset += 100) {
    const batch = files.slice(offset, offset + 100);
    const hashes = (await git('hash-object', '--', ...batch.map((file) => file.path))).split('\n');
    if (hashes.length !== batch.length || hashes.some((hash, index) => hash !== batch[index]!.hash))
      throw new Error('レビュー済みの変更をコミットし、作業ツリーを clean にしてください。');
  }
  return configKeys;
}

export async function safePush(options: Options, root = repository, run: Run = runGit) {
  checkBranch(options.branch);
  const git = async (...args: string[]) => (await run(args, root)).replace(/\r?\n$/, '');
  if (realpathSync(await git('rev-parse', '--show-toplevel')) !== realpathSync(root))
    throw new Error('スクリプトと Git リポジトリのルートが一致しません。');
  const grafts = await git('rev-parse', '--path-format=absolute', '--git-path', 'info/grafts');
  if (lstatSync(grafts, { throwIfNoEntry: false })) throw new Error('info/grafts が存在するため Push できません。');
  if ((await git('symbolic-ref', '--quiet', '--short', 'HEAD')) !== options.branch)
    throw new Error('現在のブランチと --branch が一致しません。');
  const configKeys = await checkedWorktree(root, run);
  const commit = await git('rev-parse', '--verify', 'HEAD^{commit}');
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('HEAD の commit SHA を確認できません。');
  const fetchUrl = await git('remote', 'get-url', '--all', 'origin');
  const pushUrl = await git('remote', 'get-url', '--push', '--all', 'origin');
  if (!approvedUrls.has(fetchUrl) || !approvedUrls.has(pushUrl))
    throw new Error('origin の取得先・Push 先は対象 GitHub リポジトリの単一 URL に限定します。');
  const sshTransport = pushUrl.startsWith('git@') || pushUrl.startsWith('ssh://');
  for (const key of configKeys) {
    if (key.toLowerCase().startsWith('url.') || (sshTransport && key.toLowerCase() === 'core.sshcommand'))
      throw new Error('URL・TLS 検証・SSH コマンドの設定が上書きされているため Push できません。');
    if (/^http(?:\..+)?\.schannelcheckrevoke$/i.test(key)) {
      if ((await git('config', '--type=bool', '--get-all', key)).split('\n').some((value) => value !== 'true'))
        throw new Error('TLS 証明書の失効確認を無効にする設定があるため Push できません。');
    }
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
  if (!sshTransport) {
    // URL 別設定の優先順位と boolean の表記は Git 自身で判定する。
    let verify = 'true';
    try {
      verify = await git('config', '--type=bool', '--get-urlmatch', 'http.sslVerify', pushUrl);
    } catch (error) {
      const failure = (error instanceof Error && error.cause ? error.cause : error) as {
        code?: number;
        status?: number;
        stderr?: string | Buffer;
      };
      // 未設定だけを既定の有効化として扱い、不正な値や実行失敗は伝播する。
      if ((failure.code ?? failure.status) !== 1 || String(failure.stderr ?? 'unknown') !== '') throw error;
    }
    if (verify !== 'true') throw new Error('TLS 証明書の検証を無効にする設定があるため Push できません。');
  }
  const credentials = sshTransport ? [] : await credentialOptions(root, configKeys, run);
  const remoteGit = async (...args: string[]) =>
    (await run([...credentials, ...args], root, sshTransport)).replace(/\r?\n$/, '');
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
