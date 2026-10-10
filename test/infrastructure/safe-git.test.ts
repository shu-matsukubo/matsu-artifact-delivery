import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { type TestContext } from 'node:test';
import { parseArguments, runGit, safePush } from '../../.agents/skills/safe-git/scripts/push.ts';
import { runProcess } from '../../.agents/skills/safe-git/scripts/process.ts';
import { frontmatter, localLinks, read, repository, temporaryDirectory } from '../lib/plugin.ts';

const url = 'https://github.com/shu-matsukubo/matsu-artifact-delivery.git';
const branch = 'codex/issue-51';
const head = 'a'.repeat(40);
type Run = (args: string[], cwd: string, sshTransport?: boolean) => string;

function fixture(root = repository) {
  const calls: string[][] = [];
  const replies = new Map<string, string>([
    ['rev-parse --show-toplevel', root],
    ['rev-parse --path-format=absolute --git-path info/grafts', join(root, '.git/info/grafts')],
    ['symbolic-ref --quiet --short HEAD', branch],
    ['ls-files -v -z', 'H file'],
    ['-c core.fsmonitor=false update-index --really-refresh', ''],
    ['-c core.fsmonitor=false status --porcelain=v1 --untracked-files=all', ''],
    ['rev-parse --verify HEAD^{commit}', head],
    ['remote get-url --all origin', url],
    ['remote get-url --push --all origin', url],
    ['config --name-only --list', ''],
    [
      'config --null --show-origin --show-scope --get-all http.sslcainfo',
      'global\0file:/untrusted\0/untrusted/ca.crt\0',
    ],
    [`ls-remote --symref ${url} HEAD refs/heads/${branch}`, `ref: refs/heads/main\tHEAD\n${head}\tHEAD\n`],
  ]);
  const run: Run = (args) => {
    calls.push(args);
    if (args.includes('push')) return 'ok';
    const reply = replies.get(args.join(' '));
    assert.notEqual(reply, undefined, `Unexpected Git command: ${args.join(' ')}`);
    return reply!;
  };
  return { calls, replies, run };
}

await test('SGT-U01: Push は検証済み URL と単一の commit:branch を使い、dry-run は更新しない', async () => {
  const { run, calls } = fixture();
  const plan = await safePush({ branch, dryRun: true }, repository, run);
  assert.equal(plan.commit, head);
  assert.equal(plan.branch, branch);
  assert.equal(
    calls.some((args) => args.includes('push')),
    false,
  );
  await safePush({ branch, dryRun: false }, repository, run);
  const push = calls.find((args) => args.includes('push'))!;
  assert.deepEqual(push.slice(-3), ['--', url, `${head}:refs/heads/${branch}`]);
  for (const option of ['--no-verify', '--no-follow-tags', '--recurse-submodules=no']) assert.ok(push.includes(option));
  assert.ok(push.includes(`--force-with-lease=refs/heads/${branch}:`));
  assert.ok(!push.some((arg) => /^(?:--force|\+|--mirror|--delete|--all|--tags)(?:$|[^-])/.test(arg)));
  const existing = fixture();
  existing.replies.set(
    `ls-remote --symref ${url} HEAD refs/heads/${branch}`,
    `ref: refs/heads/main\tHEAD\n${head}\tHEAD\n${head}\trefs/heads/${branch}`,
  );
  existing.replies.set(`--no-replace-objects merge-base --is-ancestor ${head} ${head}`, '');
  await safePush({ branch, dryRun: false }, repository, existing.run);
  assert.ok(
    existing.calls.find((args) => args.includes('push'))!.includes(`--force-with-lease=refs/heads/${branch}:${head}`),
  );
});

await test('SGT-U02: 入力・リポジトリ・作業状態・接続先の不一致では Push しない', async () => {
  assert.deepEqual(parseArguments(['--branch', branch, '--dry-run']), { branch, dryRun: true });
  for (const args of [
    [],
    ['--branch'],
    ['--branch', branch, '--force'],
    ['--delete'],
    ['--repo', '.'],
    ['--branch', branch, '--branch', branch],
    ['--branch', ':main'],
    ['--branch', '+HEAD:main'],
    ['--branch', '--all'],
    ['--branch', 'main'],
    ['--branch', 'master'],
    ['--branch', 'release/1'],
    ['--branch', 'bad..branch'],
    ['--branch', 'topic:main'],
  ]) {
    assert.throws(() => parseArguments(args));
  }
  const cases: [string, string | Error][] = [
    ['rev-parse --show-toplevel', join(repository, 'plugins')],
    ['symbolic-ref --quiet --short HEAD', 'other-branch'],
    ['symbolic-ref --quiet --short HEAD', new Error('detached HEAD')],
    ['-c core.fsmonitor=false update-index --really-refresh', new Error('index refresh failure')],
    ['-c core.fsmonitor=false status --porcelain=v1 --untracked-files=all', '?? unreviewed.ts'],
    ['remote get-url --all origin', 'https://github.com/other/repository.git'],
    ['remote get-url --push --all origin', 'https://github.com/attacker/repo.git'],
    ['remote get-url --push --all origin', `${url}\n${url}`],
    ['remote get-url --push --all origin', 'ext::command'],
    ['config --name-only --list', 'url.ssh://attacker/.pushinsteadof'],
    ['config --name-only --list', 'http.sslverify'],
    ['config --name-only --list', 'http.https://github.com/.sslverify'],
    ...['sslCAInfo', 'sslCAPath', 'proxySSLCAInfo'].flatMap((key): [string, string][] => [
      ['config --name-only --list', `http.${key}`],
      ['config --name-only --list', `http.https://github.com/.${key}`],
    ]),
    [`ls-remote --symref ${url} HEAD refs/heads/${branch}`, ''],
    [`ls-remote --symref ${url} HEAD refs/heads/${branch}`, `ref: refs/heads/${branch}\tHEAD\n${head}\tHEAD`],
    [`ls-remote --symref ${url} HEAD refs/heads/${branch}`, new Error('network failure')],
  ];
  for (const [command, result] of cases) {
    const f = fixture();
    if (typeof result === 'string') f.replies.set(command, result);
    const run: Run = (args, cwd) => {
      if (args.join(' ') === command && result instanceof Error) throw result;
      return f.run(args, cwd);
    };
    await assert.rejects(() => safePush({ branch, dryRun: false }, repository, run), command);
    assert.equal(
      f.calls.some((args) => args.includes('push')),
      false,
      command,
    );
  }
  const ssh = fixture();
  const sshUrl = 'git@github.com:shu-matsukubo/matsu-artifact-delivery.git';
  ssh.replies.set('remote get-url --all origin', sshUrl);
  ssh.replies.set('remote get-url --push --all origin', sshUrl);
  ssh.replies.set('config --name-only --list', 'core.sshCommand');
  await assert.rejects(() => safePush({ branch, dryRun: false }, repository, ssh.run), /SSH コマンド/);
  assert.equal(
    ssh.calls.some((args) => args.includes('ls-remote') || args.includes('push')),
    false,
  );
});

async function gitFixture(t: TestContext) {
  const root = await temporaryDirectory(t);
  const cwd = join(root, 'work');
  const remote = join(root, 'remote.git');
  await mkdir(cwd);
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '--bare', '--initial-branch=main', remote);
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  await writeFile(join(cwd, 'file'), 'base');
  git('add', 'file');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  // ネットワークや Push を使わず bare remote の基点を作る。
  execFileSync('git', ['fetch', cwd, 'main:main'], { cwd: remote, stdio: 'pipe' });
  git('remote', 'add', 'origin', url);
  git('switch', '-c', branch);
  await writeFile(join(cwd, 'file'), 'change');
  git('commit', '-qam', 'change');
  const commit = git('rev-parse', 'HEAD');
  // 通信先だけを置き換え、検証と Push のオプションは実 Git で評価する。
  const run: Run = (args) =>
    git(...args.map((arg) => (arg === url && (args[0] === 'ls-remote' || args.includes('push')) ? remote : arg)));
  return { cwd, remote, git, base, commit, run };
}

await test('SGT-U03: 実 Git で新規・fast-forward の単一ブランチを Push し、他の ref を保つ', async (t) => {
  const f = await gitFixture(t);
  f.git('config', 'push.followTags', 'true');
  f.git('config', 'remote.origin.mirror', 'true');
  f.git('config', 'remote.origin.push', '+refs/heads/*:refs/heads/*');
  f.git('tag', '-am', 'tag', 'v-test');
  await writeFile(join(f.cwd, '.git/hooks/pre-push'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  f.git('config', 'core.hooksPath', '.git/hooks');
  await safePush({ branch, dryRun: true }, f.cwd, f.run);
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`), '');
  await safePush({ branch, dryRun: false }, f.cwd, f.run);
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`).split('\t')[0], f.commit);
  assert.equal(f.git('ls-remote', f.remote, 'refs/heads/main').split('\t')[0], f.base);
  assert.equal(f.git('ls-remote', f.remote, 'refs/tags/*'), '');
  await writeFile(join(f.cwd, 'file'), 'next');
  f.git('commit', '-qam', 'next');
  await safePush({ branch, dryRun: false }, f.cwd, f.run);
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`).split('\t')[0], f.git('rev-parse', 'HEAD'));
});

await test('SGT-U11: 不正な fsmonitor が変更を隠しても Push しない', async (t) => {
  const f = await gitFixture(t);
  const hook = join(f.cwd, '.git/hooks/fake-fsmonitor');
  await writeFile(hook, "#!/bin/sh\nprintf 'token\\0'\n", { mode: 0o755 });
  f.git('config', 'core.fsmonitor', hook.replaceAll('\\', '/'));
  f.git('status', '--porcelain=v1');
  await writeFile(join(f.cwd, 'file'), 'unreviewed change');
  assert.equal(f.git('status', '--porcelain=v1'), '');
  await assert.rejects(() => safePush({ branch, dryRun: false }, f.cwd, f.run), /clean/);
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`), '');
});

await test('SGT-U13: assume-unchanged の未変更ファイルは許可し、隠れた変更は通信前に拒否する', async (t) => {
  const f = await gitFixture(t);
  f.git('update-index', '--assume-unchanged', 'file');
  await safePush({ branch, dryRun: true }, f.cwd, f.run);
  assert.match(f.git('ls-files', '-v'), /^h file$/);
  await writeFile(join(f.cwd, 'file'), 'unreviewed change');
  assert.equal(f.git('status', '--porcelain=v1'), '');
  const calls: string[][] = [];
  const run: Run = (args, cwd) => {
    calls.push(args);
    return f.run(args, cwd);
  };
  await assert.rejects(() => safePush({ branch, dryRun: false }, f.cwd, run), /clean/);
  assert.equal(
    calls.some((args) => args.includes('ls-remote') || args.includes('push')),
    false,
  );
  assert.equal(await read(join(f.cwd, 'file')), 'unreviewed change');
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`), '');
});

await test('SGT-U15: skip-worktree の隠れた変更を通信前に拒否し、索引とファイルを保全する', async (t) => {
  const f = await gitFixture(t);
  f.git('update-index', '--skip-worktree', 'file');
  await writeFile(join(f.cwd, 'file'), 'unreviewed change');
  assert.equal(f.git('update-index', '--really-refresh'), '');
  assert.equal(f.git('status', '--porcelain=v1'), '');
  const calls: string[][] = [];
  const run: Run = (args, cwd) => {
    calls.push(args);
    return f.run(args, cwd);
  };
  await assert.rejects(() => safePush({ branch, dryRun: false }, f.cwd, run), /skip-worktree/);
  assert.equal(
    calls.some((args) => args.includes('ls-remote') || args.includes('push')),
    false,
  );
  assert.equal(await read(join(f.cwd, 'file')), 'unreviewed change');
  assert.match(f.git('ls-files', '-v'), /^S file$/);
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`), '');
});

await test('SGT-U14: 認証入力を待たず、Git のタイムアウトも失敗として返す', async (t) => {
  const execute = runProcess;
  // 通信だけをローカルの認証・SSH 設定検査に置換し、runGit の設定で実プロセスを動かす。
  async function intercept(t: TestContext) {
    const f = await gitFixture(t);
    const replies = fixture(f.cwd).replies;
    let probe: (file: string, args: string[], options: Parameters<typeof runProcess>[2]) => Promise<void>;
    const run = (args: string[], cwd: string, sshTransport = false) =>
      runGit(args, cwd, sshTransport, async (file, args, options) => {
        const index = args.indexOf('ls-remote');
        if (index >= 0) {
          await probe(file, args.slice(0, index), options);
          return replies.get(`ls-remote --symref ${url} HEAD refs/heads/${branch}`)!;
        }
        assert.ok(!args.includes('push'), '失敗した認証の後に Push しない');
        return execute(file, args, options);
      });
    return {
      ...f,
      run,
      setProbe: (value: typeof probe) => {
        probe = value;
      },
    };
  }

  await t.test('HTTPS の terminal・askpass 設定を継承しても認証入力を要求しない', async (t) => {
    const f = await intercept(t);
    const marker = join(f.cwd, '.git/asked');
    const askpass = join(f.cwd, '.git/askpass');
    await writeFile(marker, '');
    await writeFile(askpass, `#!/bin/sh\nprintf asked >> '${marker.replaceAll('\\', '/')}'\nprintf credential\n`, {
      mode: 0o755,
    });
    const before = { ...process.env };
    t.after(() => {
      process.env = before;
    });
    process.env.GIT_TERMINAL_PROMPT = '1';
    process.env.GCM_INTERACTIVE = 'always';
    process.env.GIT_ASKPASS = askpass;
    process.env.SSH_ASKPASS = askpass;
    f.git('config', 'core.askPass', askpass);
    f.setProbe(async (file, args, options) => {
      assert.equal(options.env?.GCM_INTERACTIVE, '0');
      if (process.platform === 'win32') {
        const backend = await execute(file, [...args, 'config', '--get-urlmatch', 'http.sslBackend', url], options);
        const customCA = await execute(
          file,
          [...args, 'config', '--get-urlmatch', 'http.schannelUseSSLCAInfo', url],
          options,
        );
        assert.equal(backend, 'schannel');
        assert.equal(customCA, 'false');
      }
      await execute(file, [...args, '-c', 'credential.helper=', 'credential', 'fill'], {
        ...options,
        input: 'protocol=https\nhost=safe-git.invalid\n\n',
      });
    });
    await assert.rejects(
      () => safePush({ branch, dryRun: true }, f.cwd, f.run),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Git の検証または Push に失敗/);
        assert.match(
          String((error.cause as { stderr: string }).stderr),
          /terminal prompts disabled|unable to get password from user/,
        );
        return true;
      },
    );
    assert.equal(await read(marker), '');
    const helper = join(f.cwd, '.git/credential-helper');
    await writeFile(helper, '#!/bin/sh\nprintf "username=test\\npassword=test\\n\\n"\n', { mode: 0o755 });
    f.setProbe(async (file, args, options) => {
      const output = await execute(
        file,
        [
          ...args,
          '-c',
          'credential.helper=',
          '-c',
          `credential.helper=!"${helper.replaceAll('\\', '/')}"`,
          'credential',
          'fill',
        ],
        {
          ...options,
          input: 'protocol=https\nhost=safe-git.invalid\n\n',
        },
      );
      assert.match(output, /username=test/);
    });
    await safePush({ branch, dryRun: true }, f.cwd, f.run);
    assert.equal(await read(marker), '');
  });

  await t.test('SSH の設定で BatchMode が無効でも固定 SSH で対話を止める', async (t) => {
    const f = await intercept(t);
    f.git('remote', 'set-url', 'origin', 'git@github.com:shu-matsukubo/matsu-artifact-delivery.git');
    const config = join(f.cwd, '.git/ssh-config');
    await writeFile(
      config,
      'Host *\n  BatchMode no\n  HostName attacker.invalid\n  ProxyCommand false\n  StrictHostKeyChecking no\n',
    );
    const bin = join(f.cwd, '.git/bin');
    await mkdir(bin);
    const marker = join(bin, 'executed');
    await writeFile(marker, '');
    const fakeScript = join(bin, 'fake.ts');
    await copyFile(process.execPath, join(bin, process.platform === 'win32' ? 'sh.exe' : 'sh'));
    await writeFile(
      fakeScript,
      `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, 'executed');\nprocess.exit(1);\n`,
    );
    const before = { ...process.env };
    t.after(() => {
      process.env = before;
    });
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
    process.env[pathKey] = bin + delimiter + process.env[pathKey];
    process.env.NODE_OPTIONS = '--import=' + pathToFileURL(fakeScript).href;
    f.setProbe(async (file, args, options) => {
      const command = options.env?.GIT_SSH_COMMAND ?? options.env?.GIT_SSH ?? '';
      const match = /^(?:"([^"]+)"|([^ ]+))(.*)$/.exec(command);
      assert.ok(match, '固定 SSH 実行ファイルが指定されている');
      const output = await execute(
        match[1] ?? match[2]!,
        ['-F', config, ...match[3]!.trim().split(/\s+/).filter(Boolean), '-G', 'github.com'],
        options,
      );
      assert.match(output, /^batchmode yes$/m);
      assert.match(output, /^hostname github.com$/m);
      assert.match(output, /^stricthostkeychecking (?:yes|true)$/m);
      assert.doesNotMatch(output, /^proxycommand false$/m);
      // 実 Git に SSH コマンドを起動させ、PATH の偽 sh を呼ばないことも確認する。
      await assert.rejects(() =>
        execute(file, [...args, 'ls-remote', 'ssh://git@127.0.0.1:1/unreachable'], {
          ...options,
          env: {
            ...options.env,
            GIT_SSH_COMMAND: `${command.replace('Hostname=github.com', 'Hostname=127.0.0.1').replace('Port=22', 'Port=1')} -o ConnectTimeout=1`,
          },
        }),
      );
    });
    await safePush({ branch, dryRun: true }, f.cwd, f.run);
    assert.equal(await read(marker), '');
  });

  await t.test('Git の実行時間を制限し、タイムアウト後に Push しない', async (t) => {
    const f = await intercept(t);
    f.setProbe(async (_file, _args, options) => {
      assert.ok(options.timeout && options.timeout > 0 && options.timeout <= 60_000);
      // 本番の上限だけを短縮し、終了しない子プロセスを実際に停止する。
      await execute(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...options, timeout: 100 });
    });
    await assert.rejects(
      () => safePush({ branch, dryRun: false }, f.cwd, f.run),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Git の検証または Push に失敗/);
        assert.equal((error.cause as NodeJS.ErrnoException).code, 'ETIMEDOUT');
        return true;
      },
    );
  });
});

await test('SGT-U17: 独自 CA のリポジトリ設定を実 Git で通信前に拒否する', async (t) => {
  const f = await gitFixture(t);
  for (const [key, value] of [
    ['http.sslCAInfo', '/untrusted/ca.crt'],
    ['http.sslCAPath', '/untrusted/certs'],
    ['http.https://github.com/.sslCAInfo', '/untrusted/ca.crt'],
    ['http.https://github.com/.sslCAPath', '/untrusted/certs'],
    ...['ucrt64', 'mingw64'].map((layout) => [
      'http.sslCAInfo',
      `C:/Program Files/Git/${layout}/etc/ssl/certs/ca-bundle.crt`,
    ]),
    ['http.sslCAInfo', ''],
  ]) {
    f.git('config', key!, value!);
    const calls: string[][] = [];
    const run: Run = (args, cwd) => {
      calls.push(args);
      return f.run(args, cwd);
    };
    await assert.rejects(() => safePush({ branch, dryRun: false }, f.cwd, run), /独自 CA/);
    assert.equal(
      calls.some((args) => args.includes('ls-remote') || args.includes('push')),
      false,
    );
    f.git('config', '--unset-all', key!);
  }
});

await test('SGT-U18: Windows の標準 CA の両配置を許可し、設定元・実体の偽装は通信前に拒否する', async (t) => {
  const root = await temporaryDirectory(t);
  const configFile = 'C:/Program Files/Git/etc/gitconfig';
  const bundles = ['ucrt64', 'mingw64'].map((layout) => `C:/Program Files/Git/${layout}/etc/ssl/certs/ca-bundle.crt`);
  const regularFile = join(root, 'regular-file');
  await writeFile(regularFile, 'fixture');
  const realpath = fs.realpathSync;
  const lstat = fs.lstatSync;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  let redirectedPath = '';
  let directoryPath = '';
  const protectedPaths = [configFile, ...bundles];
  t.after(() => {
    Object.defineProperty(process, 'platform', platform);
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.mock.method(fs, 'realpathSync', (path: string) =>
    protectedPaths.includes(path) ? (path === redirectedPath ? '/untrusted/file' : path) : realpath(path),
  );
  t.mock.method(fs, 'lstatSync', (path: string, options?: { throwIfNoEntry?: boolean }) =>
    protectedPaths.includes(path) ? lstat(path === directoryPath ? root : regularFile) : lstat(path, options),
  );
  syncBuiltinESMExports();

  for (const bundle of bundles) {
    const f = fixture(root);
    f.replies.set('config --name-only --list', 'http.sslcainfo');
    const command = 'config --null --show-origin --show-scope --get-all http.sslcainfo';
    const standard = `system\0file:${configFile}\0${bundle}\0`;
    f.replies.set(command, standard);
    await safePush({ branch, dryRun: true }, root, f.run);
    assert.ok(
      f.calls.some((args) => args.includes('ls-remote')),
      bundle,
    );

    for (const [config, redirect, directory] of [
      [standard.replace('system\0', 'global\0'), '', ''],
      [standard.replace('system\0', 'local\0'), '', ''],
      [standard.replace(configFile, 'C:/Users/untrusted/gitconfig'), '', ''],
      [standard.replace(bundle, 'C:/Users/untrusted/ca.crt'), '', ''],
      [standard + standard.replace('system\0', 'local\0'), '', ''],
      [standard, configFile, ''],
      [standard, bundle, ''],
      [standard, '', bundle],
    ]) {
      f.replies.set(command, config!);
      redirectedPath = redirect!;
      directoryPath = directory!;
      f.calls.length = 0;
      await assert.rejects(() => safePush({ branch, dryRun: false }, root, f.run), /独自 CA/);
      assert.equal(
        f.calls.some((args) => args.includes('ls-remote') || args.includes('push')),
        false,
      );
    }
    redirectedPath = '';
    directoryPath = '';
  }
});

await test('SGT-U16: タイムアウト時に子・孫プロセスを停止する', async (t) => {
  const cwd = await temporaryDirectory(t);
  const pids = join(cwd, 'pids');
  const heartbeat = join(cwd, 'heartbeat');
  await writeFile(pids, '');
  await writeFile(heartbeat, '');
  const leaf = `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(pids)}, process.pid + '\\n');
setInterval(() => appendFileSync(${JSON.stringify(heartbeat)}, 'alive\\n'), 20);`;
  const parent = `import { spawn } from 'node:child_process';
${leaf}
spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(leaf)}], { stdio: 'ignore', windowsHide: true });`;
  let started: number[] = [];
  t.after(() => {
    for (const pid of started) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  });
  await assert.rejects(
    runProcess(process.execPath, ['--input-type=module', '-e', parent], { cwd, env: process.env, timeout: 2_000 }),
    { code: 'ETIMEDOUT' },
  );
  started = (await read(pids)).trim().split('\n').map(Number);
  assert.equal(started.length, 2, '子・孫が起動している');
  const stopped = await read(heartbeat);
  assert.ok(stopped.length > 0, '孫プロセスが動作していた');
  await delay(200);
  assert.equal(await read(heartbeat), stopped, 'タイムアウト後に孫プロセスを残さない');
});

await test('SGT-U12: SSH 接続のリモート操作だけに固定 SSH 実行を指定する', async () => {
  const f = fixture();
  const sshUrl = 'git@github.com:shu-matsukubo/matsu-artifact-delivery.git';
  f.replies.set('remote get-url --all origin', sshUrl);
  f.replies.set('remote get-url --push --all origin', sshUrl);
  f.replies.set(`ls-remote --symref ${sshUrl} HEAD refs/heads/${branch}`, `ref: refs/heads/main\tHEAD\n${head}\tHEAD`);
  const run: Run = (args, cwd, sshTransport) => {
    assert.equal(sshTransport ?? false, args[0] === 'ls-remote' || args.includes('push'));
    return f.run(args, cwd);
  };
  await safePush({ branch, dryRun: false }, repository, run);
});

await test('SGT-U06: CLI は未知の引数・別 cwd・Git 設定の環境変数を終了コード 1 で拒否する', async () => {
  const script = join(repository, '.agents/skills/safe-git/scripts/push.ts');
  for (const options of [
    { args: ['--force'], cwd: repository, env: process.env, message: /引数/ },
    { args: ['--branch', branch], cwd: join(repository, 'plugins'), env: process.env, message: /ルートから/ },
    {
      args: ['--branch', branch],
      cwd: repository,
      env: { ...process.env, GIT_CONFIG_COUNT: '0' },
      message: /環境変数/,
    },
    {
      args: ['--branch', branch],
      cwd: repository,
      env: { ...process.env, GIT_EXEC_PATH: join(repository, 'plugins') },
      message: /環境変数/,
    },
    ...['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT'].map((key) => ({
      args: ['--branch', branch],
      cwd: repository,
      env: { ...process.env, [key]: 'override' },
      message: /環境変数/,
    })),
    {
      args: ['--branch', branch],
      cwd: repository,
      env: { ...process.env, GIT_SSL_NO_VERIFY: 'true' },
      message: /環境変数/,
    },
    ...[
      'GIT_SSL_CAINFO',
      'GIT_SSL_CAPATH',
      'GIT_PROXY_SSL_CAINFO',
      'SSL_CERT_FILE',
      'SSL_CERT_DIR',
      'CURL_CA_BUNDLE',
    ].map((key) => ({
      args: ['--branch', branch],
      cwd: repository,
      env: { ...process.env, [key]: 'override' },
      message: /環境変数/,
    })),
  ]) {
    const result = spawnSync(process.execPath, [script, ...options.args], {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, options.message);
  }
});

await test('SGT-U07: 確認後に同名ブランチが作成された場合は Push を拒否する', async (t) => {
  const f = await gitFixture(t);
  const run: Run = (args, cwd) => {
    const result = f.run(args, cwd);
    if (args[0] === 'ls-remote')
      execFileSync('git', ['fetch', f.cwd, `main:refs/heads/${branch}`], { cwd: f.remote, stdio: 'pipe' });
    return result;
  };
  await assert.rejects(() => safePush({ branch, dryRun: false }, f.cwd, run));
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`).split('\t')[0], f.base);
});

await test('SGT-U04: non-fast-forward・Git 失敗は成功扱いせず、remote を変更しない', async (t) => {
  const f = await gitFixture(t);
  await safePush({ branch, dryRun: false }, f.cwd, f.run);
  f.git('switch', '-c', 'diverged', f.base);
  await writeFile(join(f.cwd, 'file'), 'diverged');
  f.git('commit', '-qam', 'diverged');
  f.git('branch', '-f', branch, 'HEAD');
  f.git('switch', branch);
  await assert.rejects(() => safePush({ branch, dryRun: false }, f.cwd, f.run));
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`).split('\t')[0], f.commit);
  const run: Run = (args, cwd) => {
    if (args.includes('push')) throw new Error('Push rejected');
    return f.run(args, cwd);
  };
  f.git('switch', '-c', 'fresh-branch');
  await assert.rejects(() => safePush({ branch: 'fresh-branch', dryRun: false }, f.cwd, run), /Push rejected/);
});

await test('SGT-U08: 置換 ref が偽装した祖先関係では Push しない', async (t) => {
  const f = await gitFixture(t);
  await safePush({ branch, dryRun: false }, f.cwd, f.run);
  f.git('switch', '-c', 'diverged', f.base);
  await writeFile(join(f.cwd, 'file'), 'diverged');
  f.git('commit', '-qam', 'diverged');
  const divergent = f.git('rev-parse', 'HEAD');
  f.git('branch', '-f', branch, divergent);
  f.git('switch', branch);
  f.git('replace', '--graft', divergent, f.commit);
  f.git('merge-base', '--is-ancestor', f.commit, divergent);
  await assert.rejects(() => safePush({ branch, dryRun: false }, f.cwd, f.run));
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`).split('\t')[0], f.commit);
});

await test('SGT-U09: PATH の偽 Git を実行せず、実リポジトリの接続先を検証する', async (t) => {
  const f = await gitFixture(t);
  f.git('remote', 'set-url', 'origin', 'https://github.com/other/repository.git');
  const fakeDirectory = join(await temporaryDirectory(t), 'bin');
  await mkdir(fakeDirectory);
  const marker = join(fakeDirectory, 'executed');
  const fakeScript = join(fakeDirectory, 'fake.ts');
  const fakeGit = join(fakeDirectory, process.platform === 'win32' ? 'git.exe' : 'git');
  await copyFile(process.execPath, fakeGit);
  // Node のコピーを偽 Git とし、検証をすべて通す応答を生成する。
  await writeFile(
    fakeScript,
    `import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
if (/[/\\\\]git(?:\\.exe)?$/.test(process.execPath)) {
  appendFileSync(${JSON.stringify(marker)}, 'executed\\n');
  const replies = ${JSON.stringify(Object.fromEntries(fixture(f.cwd).replies))};
  console.log(replies[[basename(process.argv[1]), ...process.argv.slice(2)].join(' ')] ?? '');
  process.exit(0);
}
`,
  );
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const env = {
    ...process.env,
    [pathKey]: fakeDirectory + delimiter + process.env[pathKey],
    NODE_OPTIONS: '--import=' + pathToFileURL(fakeScript).href,
  };
  // 通常の PATH 探索なら偽 Git が選ばれ、期待した応答を返すことを確認する。
  const probe = spawnSync('git', ['rev-parse', '--show-toplevel'], { env, encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(probe.stdout.trim(), f.cwd);
  const before = await read(marker);
  const script = pathToFileURL(join(repository, '.agents/skills/safe-git/scripts/push.ts')).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { safePush } from ${JSON.stringify(script)};
try { await safePush({ branch: ${JSON.stringify(branch)}, dryRun: true }, ${JSON.stringify(f.cwd)}); }
catch (error) { console.error(error.message); process.exitCode = 1; }`,
    ],
    { cwd: f.cwd, env, encoding: 'utf8' },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /origin/);
  assert.equal(await read(marker), before);
});

await test('SGT-U10: info/grafts が偽装した祖先関係では通常 checkout と worktree の Push を拒否する', async (t) => {
  const f = await gitFixture(t);
  await safePush({ branch, dryRun: false }, f.cwd, f.run);
  f.git('switch', '-c', 'diverged', f.base);
  await writeFile(join(f.cwd, 'file'), 'diverged');
  f.git('commit', '-qam', 'diverged');
  const divergent = f.git('rev-parse', 'HEAD');
  f.git('branch', '-f', branch, divergent);
  f.git('switch', branch);
  const grafts = f.git('rev-parse', '--path-format=absolute', '--git-path', 'info/grafts');
  await writeFile(grafts, `${divergent} ${f.commit}\n`);
  f.git('--no-replace-objects', 'merge-base', '--is-ancestor', f.commit, divergent);
  const worktree = join(await temporaryDirectory(t), 'linked');
  f.git('worktree', 'add', '-b', 'codex/linked', worktree, divergent);
  for (const [cwd, targetBranch] of [
    [f.cwd, branch],
    [worktree, 'codex/linked'],
  ]) {
    const calls: string[][] = [];
    const run: Run = (args) => {
      calls.push(args);
      return execFileSync(
        'git',
        args.map((arg) => (arg === url && (args.includes('ls-remote') || args.includes('push')) ? f.remote : arg)),
        { cwd, encoding: 'utf8', stdio: 'pipe' },
      ).trim();
    };
    await assert.rejects(() => safePush({ branch: targetBranch!, dryRun: false }, cwd, run), /grafts/);
    assert.equal(
      calls.some((args) => args.includes('ls-remote') || args.includes('push')),
      false,
    );
  }
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`).split('\t')[0], f.commit);
  assert.equal(f.git('ls-remote', f.remote, 'refs/heads/codex/linked'), '');
});

await test('SGT-U05: Skill の参照と Codex Rules の禁止・通常操作を検証する', async (t) => {
  const skill = '.agents/skills/safe-git/SKILL.md';
  assert.equal(frontmatter(await read(join(repository, skill))).metadata.name, 'safe-git');
  for (const path of [skill, '.agents/skills/safe-git/references/push.md', 'docs/codex-workflows.md'])
    await localLinks(repository, path);
  const probe = spawnSync('codex', ['--version'], { stdio: 'pipe' });
  if (probe.error) return t.skip('Codex CLI がない環境では Rules 内の match/not_match を利用する');
  const forbidden = [
    ['git', 'push', 'origin', branch],
    ['git.exe', 'push', '--force'],
    ['git', 'reset', '--hard'],
    ['git', 'clean', '-fd'],
    ['git', 'branch', '-D', branch],
    ['git', 'branch', '-M', 'source', 'target'],
    ['git', 'branch', '-C', 'source', 'target'],
    ...['--move', '--copy', '-m', '-c'].map((option) => ['git', 'branch', option, '--force', 'source', 'target']),
    ['git', 'rm', '--force', 'file'],
    ['git', 'rm', '-f', 'file'],
    ['git', 'rm', 'file', '--force'],
    ['git', 'rm', '-rf', 'directory'],
    ['git', 'mv', '-f', 'source', 'target'],
    ['git.exe', 'mv', '--force', 'source', 'target'],
    ['git', 'mv', 'source', 'target', '--force'],
    ['git', 'mv', '-v', '-f', 'source', 'target'],
    ['git', 'mv', '-vf', 'source', 'target'],
    ['git', 'mv', 'source', 'target'],
    ['git', 'mv', '-n', 'source', 'target'],
    ['git', '-C', '.', 'push'],
    ['git', 'send-pack', url],
    ['git', 'worktree', 'remove', '--force', 'path'],
    ['git', 'worktree', 'remove', 'path', '--force'],
    ['git', 'worktree', 'remove', '-f', 'path'],
  ];
  const allowed = [
    ['git', 'status'],
    ['git', 'diff'],
    ['git', 'add', 'file'],
    ['git', 'commit', '-m', 'change'],
    ['git', 'switch', '-c', branch],
    ['node', '.agents/skills/safe-git/scripts/push.ts', '--branch', branch],
  ];
  for (const args of [...forbidden, ...allowed]) {
    const result = JSON.parse(
      execFileSync(
        'codex',
        ['execpolicy', 'check', '--rules', join(repository, '.codex/rules/safe-git.rules'), '--', ...args],
        { encoding: 'utf8', stdio: 'pipe' },
      ),
    );
    assert.equal(result.decision === 'forbidden', forbidden.includes(args), args.join(' '));
  }
});
