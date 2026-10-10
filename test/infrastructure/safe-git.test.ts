import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { delimiter, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { type TestContext } from 'node:test';
import { parseArguments, runGit, safePush } from '../../.agents/skills/safe-git/scripts/push.ts';
import { runProcess } from '../../.agents/skills/safe-git/scripts/process.ts';
import { createBranch } from '../../.agents/skills/safe-git/scripts/create-branch.ts';
import { createCommit } from '../../.agents/skills/safe-git/scripts/commit.ts';
import { stageFiles } from '../../.agents/skills/safe-git/scripts/stage.ts';
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
    ['-c core.fsmonitor=false ls-files -v -z', 'H file'],
    ['-c core.fsmonitor=false update-index --really-refresh', ''],
    ['-c core.fsmonitor=false status --porcelain=v1 --untracked-files=all --ignore-submodules=none', ''],
    ['-c core.fsmonitor=false ls-files --stage -z', `100644 ${head} 0\tfile\0`],
    ['hash-object -- file', head],
    ['rev-parse --verify HEAD^{commit}', head],
    ['remote get-url --all origin', url],
    ['remote get-url --push --all origin', url],
    ['config --name-only --list', ''],
    ['for-each-ref --format=%(refname) refs/replace/', ''],
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
    [
      '-c core.fsmonitor=false status --porcelain=v1 --untracked-files=all --ignore-submodules=none',
      '?? unreviewed.ts',
    ],
    ['hash-object -- file', 'b'.repeat(40)],
    ['-c core.fsmonitor=false ls-files --stage -z', `100644 ${head} 1\tfile\0`],
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
  const run: Run = (args, commandRoot) =>
    execFileSync(
      'git',
      args.map((arg) => (arg === url && (args.includes('ls-remote') || args.includes('push')) ? remote : arg)),
      { cwd: commandRoot, encoding: 'utf8', stdio: 'pipe' },
    );
  return { cwd, remote, git, base, commit, run };
}

await test('SGT-U24: 新規ブランチ作成は既存 ref・作業変更を保全し、追加オプションと hook を実行しない', async (t) => {
  const f = await gitFixture(t);
  const marker = join(f.cwd, '.git/hook-ran');
  await writeFile(join(f.cwd, '.git/hooks/post-checkout'), '#!/bin/sh\necho ran > .git/hook-ran\n', { mode: 0o755 });
  await writeFile(join(f.cwd, 'file'), 'local work');
  await writeFile(join(f.cwd, 'untracked'), 'new work');
  const status = f.git('status', '--porcelain=v1');
  const newBranch = 'codex/new-work';
  assert.deepEqual(await createBranch(['--branch', newBranch], f.cwd), { branch: newBranch });
  assert.equal(f.git('rev-parse', '--abbrev-ref', 'HEAD'), newBranch);
  assert.equal(f.git('rev-parse', `refs/heads/${branch}`), f.commit);
  assert.equal(f.git('status', '--porcelain=v1'), status);
  assert.equal(fs.existsSync(marker), false);
  await assert.rejects(createBranch(['--branch', branch], f.cwd));
  for (const args of [
    [],
    ['--branch', 'main'],
    ['--branch', branch, '--force'],
    ['--branch', branch, '--dry-run'],
    ['--branch', '--discard-changes'],
  ])
    await assert.rejects(createBranch(args, f.cwd));
  assert.equal(f.git('rev-parse', '--abbrev-ref', 'HEAD'), newBranch);
  assert.equal(f.git('status', '--porcelain=v1'), status);
});

await test('SGT-U34: 新規コミットは親・ステージ内容・作業変更を保全し、amend と hook を実行しない', async (t) => {
  const f = await gitFixture(t);
  const marker = join(f.cwd, '.git/hook-ran');
  await writeFile(join(f.cwd, '.git/hooks/pre-commit'), '#!/bin/sh\necho ran > .git/hook-ran\nexit 1\n', {
    mode: 0o755,
  });
  f.git('config', 'core.hooksPath', '.git/hooks');
  f.git('config', 'commit.gpgsign', 'true');
  await writeFile(join(f.cwd, 'file'), 'staged content');
  f.git('add', 'file');
  const tree = f.git('write-tree');
  await writeFile(join(f.cwd, 'file'), 'unstaged content');
  await writeFile(join(f.cwd, 'untracked'), 'new work');
  const result = await createCommit(['--message', '--amend'], f.cwd);
  assert.equal(result.commit, f.git('rev-parse', 'HEAD'));
  assert.equal(f.git('rev-parse', 'HEAD^'), f.commit);
  assert.equal(f.git('rev-parse', 'HEAD^{tree}'), tree);
  assert.equal(f.git('show', 'HEAD:file'), 'staged content');
  assert.equal(f.git('log', '-1', '--format=%s'), '--amend', 'メッセージを Git オプションとして解釈しない');
  assert.equal(fs.existsSync(marker), false);
  assert.equal(await read(join(f.cwd, 'file')), 'unstaged content');
  assert.equal(await read(join(f.cwd, 'untracked')), 'new work');
  const status = f.git('status', '--porcelain=v1');
  const indexPath = f.git('rev-parse', '--path-format=absolute', '--git-path', 'index');
  const index = fs.readFileSync(indexPath);
  for (const args of [
    [],
    ['--message'],
    ['--message', ' '],
    ['--message', 'bad\0message'],
    ['--amend', '--no-edit'],
    ['--message', 'change', '--amend'],
    ['--message', 'change', '--message', 'extra'],
  ])
    await assert.rejects(createCommit(args, f.cwd), /--message/);
  const nested = join(f.cwd, '.git/wrong-root');
  await mkdir(nested);
  await assert.rejects(createCommit(['--message', 'change'], nested));
  assert.equal(f.git('rev-parse', 'HEAD'), result.commit);
  assert.equal(f.git('status', '--porcelain=v1'), status);
  assert.deepEqual(fs.readFileSync(indexPath), index);
  assert.equal(fs.existsSync(marker), false);
});

await test('SGT-U35: merge・sequencer・rebase の途中ではコミットせず、状態と変更を保全する', async (t) => {
  for (const state of [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'REBASE_HEAD',
    'sequencer',
    'rebase-apply',
    'rebase-merge',
    'linked/MERGE_HEAD',
  ]) {
    await t.test(state, async (t) => {
      const f = await gitFixture(t);
      let cwd = f.cwd;
      if (state.startsWith('linked/')) {
        cwd = join(f.cwd, '../linked');
        f.git('worktree', 'add', '--detach', cwd, f.commit);
      }
      const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
      await writeFile(join(cwd, 'file'), 'reviewed content');
      git('add', 'file');
      await writeFile(join(cwd, 'file'), 'local work');
      await writeFile(join(cwd, 'untracked'), 'new work');
      const name = state.replace('linked/', '');
      const statePath = git('rev-parse', '--path-format=absolute', '--git-path', name);
      const sibling = f.git('commit-tree', f.git('rev-parse', 'HEAD^{tree}'), '-p', f.base, '-m', 'sibling');
      if (['sequencer', 'rebase-apply', 'rebase-merge'].includes(name)) {
        await mkdir(statePath);
        await writeFile(join(statePath, 'todo'), 'unfinished operation');
      } else await writeFile(statePath, sibling + '\n');
      const indexPath = git('rev-parse', '--path-format=absolute', '--git-path', 'index');
      const index = fs.readFileSync(indexPath);
      const calls: string[][] = [];
      await assert.rejects(
        createCommit(['--message', 'change'], cwd, async (args, root) => {
          calls.push(args);
          return runGit(args, root);
        }),
        /途中|進行中/,
      );
      assert.equal(git('rev-parse', 'HEAD'), f.commit);
      assert.deepEqual(fs.readFileSync(indexPath), index);
      assert.equal(await read(join(cwd, 'file')), 'local work');
      assert.equal(await read(join(cwd, 'untracked')), 'new work');
      assert.equal(
        await read(['sequencer', 'rebase-apply', 'rebase-merge'].includes(name) ? join(statePath, 'todo') : statePath),
        ['sequencer', 'rebase-apply', 'rebase-merge'].includes(name) ? 'unfinished operation' : sibling + '\n',
      );
      assert.equal(
        calls.some((args) => args.includes('commit')),
        false,
      );
    });
  }
});

await test('SGT-U38: ステージ前に新規ファイルも filter を検査し、索引・作業変更・ref を保全する', async (t) => {
  const f = await gitFixture(t);
  const marker = join(f.cwd, '.git/filter-ran');
  const paths = ['new file.txt', 'file'];
  await writeFile(join(f.cwd, paths[0]!), 'new work');
  await writeFile(join(f.cwd, 'file'), 'local work');
  const indexPath = f.git('rev-parse', '--path-format=absolute', '--git-path', 'index');
  const index = fs.readFileSync(indexPath);
  const refs = f.git('show-ref');
  for (const path of paths) {
    await writeFile(join(f.cwd, '.git/info/attributes'), `"${path}" filter=unsafe\n`);
    for (const kind of ['clean', 'process']) {
      f.git('config', `filter.unsafe.${kind}`, 'echo ran > .git/filter-ran; cat');
      const calls: string[][] = [];
      await assert.rejects(
        stageFiles(['--', ...paths], f.cwd, async (args: string[], root: string) => {
          calls.push(args);
          return runGit(args, root);
        }),
        /filter/,
      );
      assert.equal(
        calls.some((args) => args.includes('add')),
        false,
      );
      assert.equal(fs.existsSync(marker), false);
      assert.deepEqual(fs.readFileSync(indexPath), index);
      assert.equal(f.git('show-ref'), refs);
      assert.equal(await read(join(f.cwd, paths[0]!)), 'new work');
      assert.equal(await read(join(f.cwd, 'file')), 'local work');
      f.git('config', '--unset', `filter.unsafe.${kind}`);
    }
  }
  // 同じ属性を通常の add に適用すると filter が動くことを確認する。
  await writeFile(join(f.cwd, '.git/info/attributes'), `"${paths[0]}" filter=unsafe\n`);
  f.git('config', 'filter.unsafe.clean', 'echo ran > .git/filter-ran; cat');
  f.git('add', '--', paths[0]!);
  assert.equal(fs.existsSync(marker), true);
  await fs.promises.unlink(marker);
  await writeFile(join(f.cwd, '.git/info/attributes'), 'unused filter=unsafe\n');
  await writeFile(join(f.cwd, '.git/hooks/post-index-change'), '#!/bin/sh\necho ran > .git/filter-ran\n', {
    mode: 0o755,
  });
  const literal = process.platform === 'win32' ? 'literal[1].txt' : ':literal*';
  await writeFile(join(f.cwd, literal), 'literal path');
  await writeFile(join(f.cwd, 'unselected'), 'keep untracked');
  await stageFiles(['--', paths[0]!, literal], f.cwd);
  assert.equal(f.git('show', `:0:${paths[0]}`), 'new work');
  assert.equal(f.git('show', `:0:${literal}`), 'literal path');
  assert.equal(f.git('show', ':0:file'), 'change');
  assert.equal(f.git('ls-files', '--', 'unselected'), '');
  assert.equal(fs.existsSync(marker), false);
  for (const args of [[], ['--'], ['--all'], ['--', ''], ['--', 'bad\0path'], ['--', '../outside'], ['--', '.']])
    await assert.rejects(stageFiles(args, f.cwd));
  await assert.rejects(stageFiles(['--', join(f.cwd, 'file')], f.cwd));
  await mkdir(join(f.cwd, 'directory'));
  await writeFile(join(f.cwd, 'directory/file'), 'unselected work');
  await assert.rejects(stageFiles(['--', 'directory'], f.cwd), /ディレクトリ/);
  await fs.promises.unlink(join(f.cwd, literal));
  await stageFiles(['--', literal], f.cwd);
  assert.equal(f.git('ls-files', '--', literal), '');
  await t.test('追跡済み submodule の更新と作業変更を保全する', async (t) => {
    const parent = await gitFixture(t);
    const source = await gitFixture(t);
    parent.git('-c', 'protocol.file.allow=always', 'submodule', 'add', source.cwd, 'sub');
    parent.git('commit', '-qm', 'submodule');
    const child = (...args: string[]) =>
      execFileSync('git', args, { cwd: join(parent.cwd, 'sub'), encoding: 'utf8', stdio: 'pipe' }).trim();
    child('config', 'user.name', 'Test');
    child('config', 'user.email', 'test@example.invalid');
    child('commit', '--allow-empty', '--no-gpg-sign', '-qm', 'reviewed update');
    const parentHead = parent.git('rev-parse', 'HEAD');
    await stageFiles(['--', 'sub'], parent.cwd);
    assert.equal(parent.git('rev-parse', ':sub'), child('rev-parse', 'HEAD'));
    assert.equal(parent.git('rev-parse', 'HEAD'), parentHead);
    const marker = join(parent.cwd, '.git/sub-filter-ran');
    await writeFile(
      child('rev-parse', '--path-format=absolute', '--git-path', 'info/attributes'),
      'file filter=unsafe\n',
    );
    child('config', 'filter.unsafe.clean', `echo ran > '${marker.replaceAll('\\', '/')}'; cat`);
    await writeFile(join(parent.cwd, 'sub/file'), 'local submodule work');
    const result = await createCommit(['--message', 'submodule update'], parent.cwd);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(parent.git('rev-parse', 'HEAD'), result.commit);
    assert.equal(parent.git('rev-parse', 'HEAD^'), parentHead);
    assert.equal(await read(join(parent.cwd, 'sub/file')), 'local submodule work');
  });
});

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
  const marker = join(f.cwd, '.git/monitor-ran');
  await writeFile(hook, '#!/bin/sh\nprintf ran >> "' + marker.replaceAll('\\', '/') + '"\nprintf "token\\0"\n', {
    mode: 0o755,
  });
  f.git('config', 'core.fsmonitor', hook.replaceAll('\\', '/'));
  f.git('status', '--porcelain=v1');
  await writeFile(join(f.cwd, 'file'), 'unreviewed change');
  assert.equal(f.git('status', '--porcelain=v1'), '');
  assert.ok(fs.existsSync(marker), '通常の Git は fsmonitor を実行する');
  await fs.promises.unlink(marker);
  f.git('config', 'filter.unused.clean', 'cat');
  await assert.rejects(() => safePush({ branch, dryRun: false }, f.cwd, f.run), /clean/);
  assert.equal(fs.existsSync(marker), false, '索引・属性の読み取りでも fsmonitor を実行しない');
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

await test('SGT-U19: stat 検査を弱める設定と復元された mtime が隠す同サイズの変更を通信前に拒否する', async (t) => {
  const f = await gitFixture(t);
  const textPath = 'text file 日本語.txt';
  await writeFile(join(f.cwd, '.gitattributes'), `"${textPath}" text eol=crlf\n`);
  await writeFile(join(f.cwd, textPath), 'first\r\nsecond\r\n');
  await writeFile(join(f.cwd, '-leading'), 'same');
  const link = join(f.cwd, 'link');
  if (process.platform === 'win32') {
    f.git('config', 'core.symlinks', 'false');
    await writeFile(link, textPath);
    const hash = f.git('hash-object', '-w', '--no-filters', '--', 'link');
    f.git('update-index', '--add', '--cacheinfo', `120000,${hash},link`);
  } else {
    await fs.promises.symlink(textPath, link);
    f.git('add', 'link');
  }
  f.git('add', '--', '.gitattributes', textPath, '-leading');
  f.git('commit', '-qm', 'content formats');
  f.git('config', 'core.trustCtime', 'false');
  f.git('config', 'core.checkStat', 'minimal');
  const file = join(f.cwd, 'file');
  const oldTime = new Date('2000-01-01T00:00:00Z');
  fs.utimesSync(file, oldTime, oldTime);
  assert.equal(f.git('status', '--porcelain=v1'), '');
  await safePush({ branch, dryRun: true }, f.cwd, f.run);
  await writeFile(file, 'hidden');
  fs.utimesSync(file, oldTime, oldTime);
  assert.equal(f.git('update-index', '--really-refresh'), '');
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
  assert.equal(await read(file), 'hidden');
  assert.equal(f.git('config', '--get', 'core.trustCtime'), 'false');
  assert.equal(f.git('config', '--get', 'core.checkStat'), 'minimal');
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`), '');
});

await test('SGT-U21: clean / process filter を作業ツリー検査より先に拒否し、コマンドを実行しない', async (t) => {
  const f = await gitFixture(t);
  const marker = join(f.cwd, '.git/filter-ran');
  await writeFile(join(f.cwd, '.git/info/attributes'), 'file filter=unsafe\n');
  for (const kind of ['clean', 'process']) {
    f.git('config', `filter.unsafe.${kind}`, 'echo ran > .git/filter-ran; cat');
    const calls: string[][] = [];
    const run: Run = (args, cwd) => {
      calls.push(args);
      return f.run(args, cwd);
    };
    await assert.rejects(() => safePush({ branch, dryRun: false }, f.cwd, run), /filter/);
    await assert.rejects(
      () => createBranch(['--branch', 'codex/new-work'], f.cwd, async (args, cwd) => run(args, cwd)),
      /filter/,
    );
    assert.equal(fs.existsSync(marker), false, 'filter の外部コマンドを起動しない');
    assert.equal(
      calls.some(
        (args) =>
          args.includes('switch') ||
          args.includes('update-index') ||
          args.includes('status') ||
          args.includes('hash-object') ||
          args.includes('ls-remote') ||
          args.includes('push'),
      ),
      false,
    );
    f.git('config', '--unset', `filter.unsafe.${kind}`);
  }
});

await test('SGT-U27: プロセス出力の空白・改行・NUL をそのまま返す', async () => {
  const output = ' \tfirst\0last \n\0 \t\n';
  assert.equal(
    await runProcess(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(output)})`], {
      cwd: repository,
      env: process.env,
    }),
    output,
  );
});

await test('SGT-U28: 空白を含むパスの filter を実 Git の出力から検出し、実行前に拒否する', async (t) => {
  for (const nested of [false, true]) {
    await t.test(nested ? '入れ子の submodule' : 'ルート', async (t) => {
      const f = await gitFixture(t);
      const source = nested ? await gitFixture(t) : f;
      const paths = [' a', ' a b.txt', ...(process.platform === 'win32' ? [] : ['\ta', '\na', 'z \n'])];
      for (const path of paths) await writeFile(join(source.cwd, path), 'content');
      source.git('add', '--', ...paths);
      source.git('commit', '-qm', 'whitespace paths');
      if (nested) {
        const parent = await gitFixture(t);
        parent.git('-c', 'protocol.file.allow=always', 'submodule', 'add', source.cwd, 'nested');
        parent.git('commit', '-qm', 'nested submodule');
        f.git('-c', 'protocol.file.allow=always', 'submodule', 'add', parent.cwd, 'sub');
        f.git('commit', '-qm', 'submodule');
        f.git('-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '--recursive');
      }
      const cwd = nested ? join(f.cwd, 'sub/nested') : f.cwd;
      const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
      const marker = join(git('rev-parse', '--absolute-git-dir'), 'filter-ran');
      const attributes = git('rev-parse', '--path-format=absolute', '--git-path', 'info/attributes');
      const calls: string[][] = [];
      const run = async (args: string[], root: string) => {
        calls.push(args);
        return args.includes('ls-remote') || args.includes('push') ? f.run(args, root) : runGit(args, root);
      };
      await safePush({ branch, dryRun: true }, f.cwd, run);
      for (const path of paths) {
        await writeFile(attributes, `${JSON.stringify(path)} filter=unsafe\n`);
        for (const kind of ['clean', 'process']) {
          git('config', `filter.unsafe.${kind}`, `echo ran > "${marker.replaceAll('\\', '/')}"; cat`);
          const operations: (() => Promise<unknown>)[] = [() => safePush({ branch, dryRun: false }, f.cwd, run)];
          if (!nested) operations.push(() => createBranch(['--branch', 'codex/new-work'], f.cwd, run));
          for (const operation of operations) {
            calls.length = 0;
            await assert.rejects(operation, /filter/);
            assert.equal(fs.existsSync(marker), false, path);
            assert.equal(
              calls.some((args) =>
                ['switch', 'update-index', 'status', 'hash-object', 'ls-remote', 'push'].some((arg) =>
                  args.includes(arg),
                ),
              ),
              false,
              path,
            );
          }
          git('config', '--unset', `filter.unsafe.${kind}`);
        }
      }
      await writeFile(attributes, '');
      if (!nested) await createBranch(['--branch', 'codex/new-work'], f.cwd, run);
      await safePush({ branch: nested ? branch : 'codex/new-work', dryRun: true }, f.cwd, run);
    });
  }
});

await test('SGT-U22: submodule の ignore 設定にかかわらず追跡・未追跡の変更を通信前に拒否する', async (t) => {
  const f = await gitFixture(t);
  const source = join(f.cwd, '.git/submodule-source');
  const sub = join(f.cwd, 'sub');
  await mkdir(source);
  const subGit = (...args: string[]) =>
    execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: 'pipe' }).trim();
  subGit('init', '--initial-branch=main');
  subGit('config', 'user.name', 'Test');
  subGit('config', 'user.email', 'test@example.invalid');
  subGit('config', 'commit.gpgsign', 'false');
  await writeFile(join(source, 'file'), 'base');
  subGit('add', 'file');
  subGit('commit', '-qm', 'base');
  f.git('-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'sub');
  f.git('config', '-f', '.gitmodules', 'submodule.sub.ignore', 'all');
  f.git('add', '.gitmodules', 'sub');
  f.git('commit', '-qm', 'submodule');
  f.git('config', 'submodule.sub.ignore', 'all');
  await safePush({ branch, dryRun: true }, f.cwd, f.run);
  for (const [path, content] of [
    ['untracked', 'new'],
    ['file', 'changed'],
  ]) {
    await writeFile(join(sub, path!), content!);
    assert.equal(f.git('status', '--porcelain=v1'), '', 'ignore=all が変更を隠す');
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
    assert.equal(await read(join(sub, path!)), content);
    if (path === 'untracked') await fs.promises.unlink(join(sub, path));
  }
});

await test('SGT-U25: 証明書失効確認の通常・URL 別設定を通信前に拒否する', async (t) => {
  const f = await gitFixture(t);
  for (const key of ['http.schannelCheckRevoke', 'http.https://github.com/.schannelCheckRevoke']) {
    f.git('config', key, 'false');
    const calls: string[][] = [];
    const run: Run = (args, cwd) => {
      calls.push(args);
      return f.run(args, cwd);
    };
    await assert.rejects(() => safePush({ branch, dryRun: false }, f.cwd, run), /TLS/);
    assert.equal(
      calls.some((args) => args.includes('ls-remote') || args.includes('push')),
      false,
    );
    f.git('config', key, 'true');
    await safePush({ branch, dryRun: true }, f.cwd, run);
    f.git('config', '--unset', key);
  }
});

await test('SGT-U26: 入れ子の submodule も索引・stat・filter・fsmonitor を検査し、変更を保全する', async (t) => {
  for (const nested of [false, true]) {
    await t.test(nested ? '入れ子の submodule' : '直下の submodule', async (t) => {
      const f = await gitFixture(t);
      const source = await gitFixture(t);
      const leaf = await gitFixture(t);
      if (nested) {
        source.git('-c', 'protocol.file.allow=always', 'submodule', 'add', leaf.cwd, 'nested');
        source.git('commit', '-qm', 'nested submodule');
      }
      f.git('-c', 'protocol.file.allow=always', 'submodule', 'add', source.cwd, 'sub');
      f.git('commit', '-qm', 'submodule');
      f.git('-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '--recursive');
      const sub = join(f.cwd, 'sub', ...(nested ? ['nested'] : []));
      const subGit = (...args: string[]) =>
        execFileSync('git', args, { cwd: sub, encoding: 'utf8', stdio: 'pipe' }).trim();
      const file = join(sub, 'file');
      // 親の status が子の filter を実行する前に検査されることも確認する。
      const marker = join(subGit('rev-parse', '--absolute-git-dir'), 'filter-ran');
      const attributes = subGit('rev-parse', '--path-format=absolute', '--git-path', 'info/attributes');
      const calls: { args: string[]; cwd: string }[] = [];
      const run: Run = (args, cwd) => {
        calls.push({ args, cwd });
        return f.run(args, cwd);
      };
      const rejected = async (message: RegExp) => {
        calls.length = 0;
        await assert.rejects(() => safePush({ branch, dryRun: false }, f.cwd, run), message);
        assert.equal(
          calls.some(({ args }) => args.includes('ls-remote') || args.includes('push')),
          false,
        );
        assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`), '');
      };
      subGit('update-index', '--assume-unchanged', 'file');
      await safePush({ branch, dryRun: true }, f.cwd, run);
      await writeFile(file, 'hidden');
      assert.equal(f.git('status', '--porcelain=v1', '--ignore-submodules=none'), '');
      await rejected(/clean/);
      assert.equal(await read(file), 'hidden');
      subGit('update-index', '--no-assume-unchanged', 'file');
      await writeFile(file, 'change');
      subGit('update-index', '--skip-worktree', 'file');
      await writeFile(file, 'hidden');
      await rejected(/skip-worktree/);
      assert.equal(await read(file), 'hidden');
      assert.match(subGit('ls-files', '-v'), /^S file$/);
      subGit('update-index', '--no-skip-worktree', 'file');
      await writeFile(file, 'change');
      subGit('config', 'core.trustCTime', 'false');
      subGit('config', 'core.checkStat', 'minimal');
      const oldTime = new Date('2000-01-01T00:00:00Z');
      fs.utimesSync(file, oldTime, oldTime);
      subGit('status', '--porcelain=v1');
      await writeFile(file, 'hidden');
      fs.utimesSync(file, oldTime, oldTime);
      assert.equal(f.git('status', '--porcelain=v1', '--ignore-submodules=none'), '');
      await rejected(/clean/);
      assert.equal(await read(file), 'hidden');
      await writeFile(file, 'change');
      const monitor = join(subGit('rev-parse', '--absolute-git-dir'), 'monitor');
      await writeFile(
        monitor,
        '#!/bin/sh\nprintf monitor >> "' + marker.replaceAll('\\', '/') + '"\nprintf "token\\0"\n',
        { mode: 0o755 },
      );
      subGit('config', 'core.fsmonitor', monitor.replaceAll('\\', '/'));
      for (const kind of ['clean', 'process']) {
        await writeFile(attributes, 'file filter=unsafe\n');
        subGit('config', `filter.unsafe.${kind}`, 'echo filter > "' + marker.replaceAll('\\', '/') + '"; cat');
        await rejected(/filter/);
        assert.equal(fs.existsSync(marker), false);
        assert.equal(
          calls.some(
            ({ args }) => args.includes('status') || args.includes('update-index') || args.includes('hash-object'),
          ),
          false,
        );
        subGit('config', '--unset', `filter.unsafe.${kind}`);
      }
      await writeFile(attributes, '');
      await safePush({ branch, dryRun: true }, f.cwd, run);
      assert.equal(fs.existsSync(marker), false, '子の fsmonitor も実行しない');
      subGit('config', '--unset', 'core.fsmonitor');
      await writeFile(file, 'hidden');
      await assert.rejects(() => safePush({ branch, dryRun: true }, f.cwd, run), /clean/);
      await writeFile(file, 'change');
      f.git('submodule', 'deinit', '--all');
      await safePush({ branch, dryRun: true }, f.cwd, run);
    });
  }
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
        assert.equal(backend.trim(), 'schannel');
        assert.equal(customCA.trim(), 'false');
        assert.equal(
          (await execute(file, [...args, 'config', '--get-urlmatch', 'http.schannelCheckRevoke', url], options)).trim(),
          'true',
        );
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
    assert.equal(sshTransport ?? false, args.includes('ls-remote') || args.includes('push'));
    return f.run(args, cwd);
  };
  await safePush({ branch, dryRun: false }, repository, run);
});

await test('SGT-U23: launcher の終了・中断で子孫を停止し、完了後に終了ハンドラーを残さない', async (t) => {
  const cwd = await temporaryDirectory(t);
  const module = pathToFileURL(join(repository, '.agents/skills/safe-git/scripts/process.ts')).href;
  for (const signal of ['SIGTERM', 'SIGINT', 'exit'] as const) {
    const heartbeat = join(cwd, signal);
    const pids = join(cwd, `${signal}.pids`);
    const leaf = `import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(pids)}, process.pid + '\\n');
setInterval(() => appendFileSync(${JSON.stringify(heartbeat)}, 'alive\\n'), 20);`;
    const parent = `import { spawn } from 'node:child_process';
${leaf}
spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(leaf)}], { stdio: 'ignore', windowsHide: true });`;
    const launcher = `import { runProcess } from ${JSON.stringify(module)};
process.on('message', () => ${signal === 'exit' ? 'process.exit(0)' : `process.emit('${signal}')`});
await runProcess(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(parent)}], { cwd: ${JSON.stringify(cwd)}, env: process.env }).catch(() => {});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', launcher], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
    const ended = new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', resolve);
    });
    t.after(() => {
      child.kill('SIGKILL');
      if (fs.existsSync(pids))
        for (const pid of fs.readFileSync(pids, 'utf8').trim().split('\n').map(Number)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          }
        }
    });
    for (
      let attempt = 0;
      attempt < 100 && (!fs.existsSync(pids) || fs.readFileSync(pids, 'utf8').trim().split('\n').length < 2);
      attempt++
    )
      await delay(20);
    assert.equal(fs.readFileSync(pids, 'utf8').trim().split('\n').length, 2);
    if (process.platform === 'win32' || signal === 'exit') child.send('stop');
    else child.kill(signal);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 3_000);
    const code = await ended;
    clearTimeout(timeout);
    assert.equal(code, signal === 'exit' ? 0 : signal === 'SIGINT' ? 130 : 143);
    const stopped = await read(heartbeat);
    await delay(200);
    assert.equal(await read(heartbeat), stopped, signal);
  }
  const events = ['SIGTERM', 'SIGINT', 'exit'] as const;
  const listeners = events.map((event) => process.listenerCount(event));
  await runProcess(process.execPath, ['-e', ''], { cwd, env: process.env });
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'setInterval(() => {}, 20)'], { cwd, env: process.env, timeout: 100 }),
  );
  assert.deepEqual(
    events.map((event) => process.listenerCount(event)),
    listeners,
  );
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
  const stage = join(repository, '.agents/skills/safe-git/scripts/stage.ts');
  for (const options of [
    { args: ['--all'], cwd: repository, env: process.env, message: /引数/ },
    { args: ['--', 'AGENTS.md'], cwd: join(repository, 'plugins'), env: process.env, message: /ルートから/ },
    {
      args: ['--', 'AGENTS.md'],
      cwd: repository,
      env: { ...process.env, GIT_EXEC_PATH: repository },
      message: /環境変数/,
    },
  ]) {
    const result = spawnSync(process.execPath, [stage, ...options.args], {
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
    if (args.includes('ls-remote'))
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

await test('SGT-U33: 置換 ref が HEAD と索引の差分を隠しても通信前に拒否し、変更を保全する', async (t) => {
  for (const depth of [0, 1, 2]) {
    await t.test(`submodule の深さ ${depth}`, async (t) => {
      const f = await gitFixture(t);
      let source = f;
      if (depth > 0) {
        source = await gitFixture(t);
        if (depth === 2) {
          const parent = await gitFixture(t);
          parent.git('-c', 'protocol.file.allow=always', 'submodule', 'add', source.cwd, 'nested');
          parent.git('commit', '-qm', 'nested submodule');
          source = parent;
        }
        f.git('-c', 'protocol.file.allow=always', 'submodule', 'add', source.cwd, 'sub');
        f.git('commit', '-qm', 'submodule');
        f.git('-c', 'protocol.file.allow=always', 'submodule', 'update', '--init', '--recursive');
      }
      const cwd = depth === 0 ? f.cwd : join(f.cwd, depth === 1 ? 'sub' : 'sub/nested');
      const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
      git('config', 'user.name', 'Test');
      git('config', 'user.email', 'test@example.invalid');
      const actualHead = git('rev-parse', 'HEAD');
      await writeFile(join(cwd, 'file'), 'reviewed content');
      git('add', 'file');
      const replacement = git('commit-tree', git('write-tree'), '-m', 'replacement');
      git('replace', actualHead, replacement);
      assert.equal(git('status', '--porcelain=v1'), '', '置換 ref が本来の HEAD と索引の差分を隠す');
      const index = fs.readFileSync(git('rev-parse', '--path-format=absolute', '--git-path', 'index'));
      const calls: string[][] = [];
      const run: Run = (args, root) => {
        calls.push(args);
        return f.run(args, root);
      };
      await assert.rejects(safePush({ branch, dryRun: false }, f.cwd, run), /置換 ref/);
      if (depth === 0) {
        await assert.rejects(
          createBranch(['--branch', 'codex/no-replace'], f.cwd, async (args, root) => run(args, root)),
          /置換 ref/,
        );
        await assert.rejects(
          createCommit(['--message', 'change'], f.cwd, async (args, root) => run(args, root)),
          /置換 ref/,
        );
      }
      assert.equal(
        calls.some((args) => ['ls-remote', 'push', 'switch', 'commit'].some((command) => args.includes(command))),
        false,
      );
      assert.equal(git('rev-parse', 'HEAD'), actualHead);
      assert.equal(git('for-each-ref', '--format=%(objectname)', 'refs/replace/'), replacement);
      assert.deepEqual(fs.readFileSync(git('rev-parse', '--path-format=absolute', '--git-path', 'index')), index);
      assert.equal(await read(join(cwd, 'file')), 'reviewed content');
      assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`), '');
    });
  }
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

await test('SGT-U20: Skill の起動手順が Node の preload を起動前に除去し、固定 Node で CLI を実行する', async (t) => {
  const root = await temporaryDirectory(t);
  const marker = join(root, 'preloaded');
  const bin = join(root, 'bin');
  await mkdir(bin);
  await copyFile(process.execPath, join(bin, process.platform === 'win32' ? 'node.exe' : 'node'));
  const skill = await read(join(repository, '.agents/skills/safe-git/SKILL.md'));
  const blocks = [...skill.matchAll(/```(powershell|sh)\r?\n([\s\S]*?)```/g)];
  const block = blocks.find((match) => match[1] === (process.platform === 'win32' ? 'powershell' : 'sh')) ?? blocks[0];
  assert.ok(block);
  const node = process.platform === 'win32' ? 'C:/Program Files/nodejs/node.exe' : '/usr/bin/node';
  assert.ok(block[2]!.includes(node), 'PATH 探索を使わず固定 Node を起動する');
  let command = block[2]!.replaceAll('<作業ブランチ>', 'invalid..branch');
  // CI の toolcache を含め、Node の配置だけを試験用 Node に置き換える。
  const testNode = process.execPath.replaceAll('\\', '/');
  command = command.replaceAll(
    node,
    process.platform === 'win32' ? testNode.replaceAll("'", "''") : "'" + testNode.replaceAll("'", "'\\''") + "'",
  );
  const executable =
    process.platform === 'win32' ? 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : '/bin/bash';
  const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  for (const mode of ['import', 'require']) {
    const preload = join(root, mode === 'import' ? 'preload.mjs' : 'preload.cjs');
    await writeFile(
      preload,
      `${mode === 'import' ? "import { writeFileSync } from 'node:fs';" : "const { writeFileSync } = require('node:fs');"}\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\nprocess.exit(0);\n`,
    );
    const env = {
      ...process.env,
      [pathKey]: bin + delimiter + process.env[pathKey],
      NODE_OPTIONS:
        mode === 'import' ? '--import=' + pathToFileURL(preload).href : '--require=' + JSON.stringify(preload),
      NODE_PATH: bin,
    };
    const probe = spawnSync(process.execPath, ['-e', ''], { env, encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(await read(marker), 'executed');
    await fs.promises.unlink(marker);
    const result = spawnSync(executable, args, { cwd: repository, env, encoding: 'utf8' });
    assert.equal(fs.existsSync(marker), false, `${mode}: preload が実行されない`);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /作業ブランチ名/);
  }
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
    ...['git', 'git.exe'].flatMap((git) => [
      [git, 'fast-import'],
      [git, 'fast-import', '--force'],
      [git, 'fast-import', '--quiet', '--force'],
      [git, 'commit', '--amend', '--no-edit'],
      [git, 'commit', '--no-edit', '--amend'],
      [git, 'commit', '-m', 'change', '--amend'],
      [git, 'commit', '--am'],
      [git, 'add', 'file'],
      [git, 'add', '--all'],
      [git, 'add', '--', 'file'],
      [git, 'add', '-p', 'file'],
      [git, 'add', '--renormalize', 'file'],
      [git, 'update-index', '--force-remove', 'file'],
      [git, 'update-index', 'file', '--force-remove'],
      [git, 'update-index', '--cacheinfo', `100644,${head},file`],
      [git, 'update-index', '--index-info'],
      [git, 'replace', head, 'b'.repeat(40)],
      ...['refs/heads/topic', 'refs/tags/v1'].flatMap((ref) => [
        [git, 'refs', 'update', ref, head],
        [git, 'refs', 'update', '--no-deref', ref, head],
        [git, 'refs', 'delete', ref],
        [git, 'refs', 'create', ref, head],
        [git, 'refs', 'rename', ref, ref + '-new'],
      ]),
    ]),
    ['git', 'push', 'origin', branch],
    ['git.exe', 'push', '--force'],
    ['git', 'reset', '--hard'],
    ['git', 'clean', '-fd'],
    ['git', 'branch', '-D', branch],
    ['git', 'branch', '--list'],
    ...['-D', '-d', '--delete', '-f', '--force'].flatMap((option) => [
      ['git', 'branch', branch, option],
      ['git.exe', 'branch', branch, option],
    ]),
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
    ...[
      '-p',
      '-P',
      '--no-pager',
      '--paginate',
      '--no-replace-objects',
      '--no-lazy-fetch',
      '--no-optional-locks',
      '--no-advice',
      '--literal-pathspecs',
      '--no-literal-pathspecs',
      '--glob-pathspecs',
      '--noglob-pathspecs',
      '--icase-pathspecs',
    ].flatMap((option) => [
      ['git', option, 'push', 'origin', branch],
      ['git.exe', option, 'reset', '--hard'],
    ]),
    ...['--discard-changes', '-f', '--force', '-C', '--force-create'].flatMap((option) => [
      ['git', 'switch', 'main', option],
      ['git.exe', 'switch', 'main', option],
    ]),
    ['git', 'switch', '-c', branch, '--discard-changes'],
    ['git', 'switch', '-c', branch],
    ['git', 'checkout-index', '-f', '-a'],
    ['git.exe', 'checkout-index', 'file', '--force'],
    ['git', 'checkout-index', '--all', '--force'],
    ['git', 'read-tree', '--reset', '-u', 'HEAD'],
    ['git.exe', 'read-tree', 'HEAD', '--reset', '-u'],
    ['git', 'read-tree', '--reset', 'HEAD', '-u'],
    ...(
      [
        ['deinit', '--all'],
        ['update', '--recursive'],
      ] as const
    ).flatMap(([command, option]) => [
      ['git', 'submodule', command, '--force', option],
      ['git.exe', 'submodule', command, 'sub', '-f'],
      ['git', 'submodule', '--quiet', command, '--force', option],
      ['git', 'submodule', '-q', command, '-f'],
    ]),
    ...['--delete', '-d', '--force', '-f'].flatMap((option) => [
      ['git', 'tag', 'v1', option],
      ['git.exe', 'tag', 'v1', option, 'HEAD'],
    ]),
    ['git', 'send-pack', url],
    ['git', 'worktree', 'remove', '--force', 'path'],
    ['git', 'worktree', 'remove', 'path', '--force'],
    ['git', 'worktree', 'remove', '-f', 'path'],
    ...['git', 'git.exe'].flatMap((git) => [
      ...['merge', 'am', 'cherry-pick', 'revert'].flatMap((command) => [
        [git, command, '--abort'],
        [git, command, '--quiet', '--abort'],
      ]),
      [git, 'fetch', 'origin', '+topic:refs/heads/topic'],
      [git, 'fetch', '--force', 'origin', 'topic:refs/heads/topic'],
      [git, 'fetch', 'origin', 'topic:refs/tags/v1', '-f'],
      [git, 'fetch', '--prune', '--prune-tags', 'origin'],
      [git, 'fetch', 'origin', 'topic:refs/heads/topic'],
      [git, 'pull', '--force', 'origin', 'topic:refs/heads/topic'],
      [git, 'pull', 'origin', '+topic:refs/tags/v1'],
      [git, 'pull', '--rebase'],
      [git, 'worktree', 'add', '-B', 'topic', 'path', 'HEAD~1'],
      [git, 'worktree', 'add', 'path', 'HEAD~1', '-B', 'topic'],
      [git, 'worktree', 'add', '--detach', 'path', '-B', 'topic', 'HEAD~1'],
      [git, 'worktree', 'add', '-b', 'topic', 'path'],
      [git, 'worktree', 'add', '--orphan', '-b', 'topic', 'path'],
      [git, 'worktree', 'add', 'path'],
    ]),
  ];
  const allowed = [
    ['git', 'status'],
    ['git', 'for-each-ref', 'refs/heads/'],
    ['git', 'for-each-ref', 'refs/tags/'],
    ['git', 'diff'],
    ['git', 'refs', 'list'],
    ['git', 'refs', 'exists', 'refs/heads/topic'],
    ['git', 'refs', 'verify'],
    ['git', 'worktree', 'list', '--porcelain'],
    ['git', 'ls-remote', 'origin'],
    ['C:/Program Files/nodejs/node.exe', '.agents/skills/safe-git/scripts/push.ts', '--branch', branch],
    ['C:/Program Files/nodejs/node.exe', '.agents/skills/safe-git/scripts/create-branch.ts', '--branch', branch],
    ['C:/Program Files/nodejs/node.exe', '.agents/skills/safe-git/scripts/commit.ts', '--message', 'change'],
    ['C:/Program Files/nodejs/node.exe', '.agents/skills/safe-git/scripts/stage.ts', '--', 'file'],
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

await test('SGT-U29: 任意の credential helper を通常・URL 別設定で通信前に拒否する', async (t) => {
  const f = await gitFixture(t);
  const marker = join(f.cwd, '.git/helper-ran');
  const command = `!printf ran > '${marker.replaceAll('\\', '/')}'; printf 'username=test\\npassword=test\\n'`;
  for (const key of ['credential.helper', 'credential.https://github.com.helper']) {
    for (const value of [command, 'unknown-helper', 'manager --option']) {
      f.git('config', '--add', key, value);
      const calls: string[][] = [];
      await assert.rejects(
        safePush({ branch, dryRun: false }, f.cwd, (args, cwd) => {
          calls.push(args);
          return f.run(args, cwd);
        }),
        /credential helper/,
      );
      assert.equal(
        calls.some((args) => args.includes('ls-remote') || args.includes('push')),
        false,
      );
      assert.equal(fs.existsSync(marker), false);
      f.git('config', '--unset-all', key);
    }
    const missing = fixture();
    missing.replies.set('config --name-only --list', key);
    missing.replies.set('config --null --list', key + '\0');
    await assert.rejects(
      safePush({ branch, dryRun: false }, repository, (args, cwd) =>
        missing.run(args.includes('ls-remote') ? args.slice(args.indexOf('ls-remote')) : args, cwd),
      ),
      /credential helper/,
    );
    assert.equal(
      missing.calls.some((args) => args.includes('ls-remote') || args.includes('push')),
      false,
    );
  }
});

await test('SGT-U30: partial clone の未検証 remote を Push・ブランチ作成の前に拒否する', async (t) => {
  const f = await gitFixture(t);
  const marker = join(f.cwd, '.git/lazy-ran');
  const helper = join(f.cwd, '.git/lazy-helper');
  await writeFile(helper, `#!/bin/sh\nprintf ran > '${marker.replaceAll('\\', '/')}'\nexit 1\n`, { mode: 0o755 });
  f.git('remote', 'add', 'lazy', 'ext::sh ' + helper.replaceAll('\\', '/').replaceAll(' ', '% '));
  f.git('config', 'protocol.ext.allow', 'always');
  const missing = 'b'.repeat(40);
  for (const [key, value] of [
    ['remote.lazy.promisor', 'true'],
    ['extensions.partialClone', 'lazy'],
  ] as const) {
    f.git('config', key, value);
    const calls: string[][] = [];
    const run = async (args: string[], cwd: string) => {
      calls.push(args);
      if (args.includes('ls-remote')) return `ref: refs/heads/main\tHEAD\n${missing}\trefs/heads/${branch}\n`;
      return runGit(args, cwd);
    };
    await assert.rejects(safePush({ branch, dryRun: false }, f.cwd, run), /partial clone/);
    await assert.rejects(createBranch(['--branch', 'codex/no-lazy'], f.cwd, run), /partial clone/);
    assert.equal(
      calls.some((args) => args.includes('ls-remote') || args.includes('push') || args.includes('switch')),
      false,
    );
    assert.equal(fs.existsSync(marker), false);
    f.git('config', '--unset-all', key);
  }
  await runGit(['rev-parse', 'HEAD'], f.cwd, false, async (_file, _args, options) => {
    assert.equal(options.env?.GIT_NO_LAZY_FETCH, '1');
    assert.equal(options.env?.GIT_NO_REPLACE_OBJECTS, '1');
    return '';
  });
});

await test('SGT-U32: 許可した helper は固定パスで起動し、HTTPS と SSH の認証経路を保つ', async (t) => {
  const f = await gitFixture(t);
  const script = join(f.cwd, '.git/test-helper');
  await writeFile(
    script,
    '#!/bin/sh\ngit rev-parse --show-toplevel >/dev/null || exit 1\nprintf "username=test\\npassword=test\\n\\n"\n',
    { mode: 0o755 },
  );
  const helper = process.platform === 'win32' ? 'manager' : process.platform === 'darwin' ? 'osxkeychain' : 'store';
  const path =
    process.platform === 'win32'
      ? 'C:/Program Files/Git/ucrt64/bin/git-credential-manager.exe'
      : process.platform === 'darwin'
        ? '/Library/Developer/CommandLineTools/usr/libexec/git-core/git-credential-osxkeychain'
        : '/usr/lib/git-core/git-credential-store';
  const realpath = fs.realpathSync;
  const lstat = fs.lstatSync;
  const stat = lstat(script);
  let redirected = false;
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.method(fs, 'realpathSync', (value: string) =>
    value === path ? (redirected ? script : path) : realpath(value),
  );
  t.mock.method(fs, 'lstatSync', (value: string, options?: { throwIfNoEntry?: boolean }) =>
    value === path
      ? Object.assign(Object.create(stat), { uid: 0, mode: 0o100755 })
      : process.platform !== 'win32' && path.startsWith(value + '/')
        ? Object.assign(Object.create(lstat(f.cwd)), { uid: 0, mode: 0o040755 })
        : lstat(value, options),
  );
  syncBuiltinESMExports();
  f.git('config', '--add', 'credential.helper', '');
  f.git('config', '--add', 'credential.helper', helper);
  f.git('config', '--add', 'credential.https://github.com.helper', '');
  f.git('config', '--add', 'credential.https://github.com.helper', helper);
  const bin = join(f.cwd, '.git/bin');
  await mkdir(bin);
  if (process.platform === 'win32') await copyFile(process.execPath, join(bin, 'git.exe'));
  else await writeFile(join(bin, 'git'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const environment = { ...process.env };
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  process.env[pathKey] = bin + delimiter + process.env[pathKey];
  t.after(() => {
    process.env = environment;
  });
  let authenticated = false;
  const run = (args: string[], cwd: string, sshTransport = false) =>
    runGit(args, cwd, sshTransport, async (file, actual, options) => {
      const index = actual.indexOf('ls-remote');
      if (index < 0) return runProcess(file, actual, options);
      const helperOptions = actual.slice(0, index);
      assert.ok(helperOptions.some((value) => value === `credential.helper=!"${path}"`));
      assert.ok(helperOptions.some((value) => value === `credential.https://github.com.helper=!"${path}"`));
      const output = await runProcess(
        file,
        [...helperOptions.map((value) => value.replaceAll(path, script.replaceAll('\\', '/'))), 'credential', 'fill'],
        { ...options, input: 'protocol=https\nhost=github.com\n\n' },
      );
      assert.match(output, /username=test/);
      authenticated = true;
      return `ref: refs/heads/main\tHEAD\n${head}\tHEAD\n`;
    });
  await safePush({ branch, dryRun: true }, f.cwd, run);
  assert.ok(authenticated);
  redirected = true;
  await assert.rejects(safePush({ branch, dryRun: true }, f.cwd, run), /credential helper/);
  redirected = false;
  const sshUrl = 'git@github.com:shu-matsukubo/matsu-artifact-delivery.git';
  const ssh = fixture();
  ssh.replies.set('config --name-only --list', 'credential.helper');
  ssh.replies.set('remote get-url --push --all origin', sshUrl);
  ssh.replies.set(
    `ls-remote --symref ${sshUrl} HEAD refs/heads/${branch}`,
    `ref: refs/heads/main\tHEAD\n${head}\tHEAD`,
  );
  await safePush({ branch, dryRun: true }, repository, (args, cwd, transport) => {
    assert.equal(transport ?? false, args.includes('ls-remote'));
    return ssh.run(args, cwd);
  });
  const https = fixture();
  https.replies.set('remote get-url --all origin', sshUrl);
  https.replies.set('config --name-only --list', 'credential.helper');
  https.replies.set('config --null --list', 'credential.helper\n!untrusted\0');
  await assert.rejects(safePush({ branch, dryRun: false }, repository, https.run), /credential helper/);
  assert.equal(
    https.calls.some((args) => args.includes('ls-remote') || args.includes('push')),
    false,
  );
});

await test('SGT-U36: Linux の helper は保護された symlink と経由先を検証し、元の名前で起動する', async (t) => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  const helper = '/usr/lib/git-core/git-credential-store';
  const intermediate = '/usr/lib/git-core/git';
  const target = '/usr/bin/git';
  const realpath = fs.realpathSync;
  const lstat = fs.lstatSync;
  const readlink = fs.readlinkSync;
  const stat = lstat(process.execPath);
  const modes = new Map<string, { uid: number; mode: number }>();
  for (const file of [helper, intermediate, target]) {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      modes.set(dir, { uid: 0, mode: 0o040755 });
      if (dir === '/') break;
    }
    modes.set(file, { uid: 0, mode: file === target ? 0o100755 : 0o120777 });
  }
  t.after(() => {
    Object.defineProperty(process, 'platform', platform);
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.method(fs, 'realpathSync', (path: string) =>
    path === helper || path === intermediate ? target : modes.has(path) ? path : realpath(path),
  );
  t.mock.method(fs, 'lstatSync', (path: string, options?: { throwIfNoEntry?: boolean }) =>
    modes.has(path) ? Object.assign(Object.create(stat), modes.get(path)) : lstat(path, options),
  );
  t.mock.method(fs, 'readlinkSync', (path: string) =>
    path === helper ? 'git' : path === intermediate ? target : readlink(path),
  );
  syncBuiltinESMExports();
  const f = fixture();
  f.replies.set('config --name-only --list', 'credential.helper');
  f.replies.set('config --null --list', 'credential.helper\nstore\0');
  const run: Run = (args, cwd) => f.run(args.includes('ls-remote') ? args.slice(args.indexOf('ls-remote')) : args, cwd);
  // multicall Git が helper 名を識別できることを確認する。
  const remote: string[][] = [];
  await safePush({ branch, dryRun: true }, repository, (args, cwd) => {
    if (args.includes('ls-remote')) remote.push(args);
    return run(args, cwd);
  });
  assert.ok(remote[0]!.includes(`credential.helper=!"${helper}"`));
  assert.ok(!remote[0]!.includes(`credential.helper=!"${target}"`));
  for (const [path, unsafe] of [
    [helper, { uid: 1000, mode: 0o120777 }],
    [intermediate, { uid: 1000, mode: 0o120777 }],
    [target, { uid: 0, mode: 0o100777 }],
    ['/usr/lib/git-core', { uid: 0, mode: 0o040777 }],
    ['/usr/bin', { uid: 1000, mode: 0o040755 }],
  ] as const) {
    const original = modes.get(path)!;
    modes.set(path, unsafe);
    await assert.rejects(safePush({ branch, dryRun: true }, repository, run), /root|credential helper/);
    modes.set(path, original);
  }
});

await test('SGT-U37: helper の通常・URL 別設定と空値リセットを設定順に再生する', async (t) => {
  const f = await gitFixture(t);
  const configPath = join(f.cwd, '.git/config');
  const initialConfig = await read(configPath);
  const script = join(f.cwd, '.git/test-helper');
  const marker = join(f.cwd, '.git/helper-ran');
  await writeFile(script, '#!/bin/sh\necho ran >> .git/helper-ran\nprintf "username=test\\npassword=test\\n\\n"\n', {
    mode: 0o755,
  });
  const helper = process.platform === 'win32' ? 'manager' : process.platform === 'darwin' ? 'osxkeychain' : 'store';
  const path =
    process.platform === 'win32'
      ? 'C:/Program Files/Git/ucrt64/bin/git-credential-manager.exe'
      : process.platform === 'darwin'
        ? '/Library/Developer/CommandLineTools/usr/libexec/git-core/git-credential-osxkeychain'
        : '/usr/lib/git-core/git-credential-store';
  const realpath = fs.realpathSync;
  const lstat = fs.lstatSync;
  const stat = lstat(script);
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.method(fs, 'realpathSync', (value: string) => (value === path ? path : realpath(value)));
  t.mock.method(fs, 'lstatSync', (value: string, options?: { throwIfNoEntry?: boolean }) =>
    value === path
      ? Object.assign(Object.create(stat), { uid: 0, mode: 0o100755 })
      : process.platform !== 'win32' && path.startsWith(value + '/')
        ? Object.assign(Object.create(lstat(f.cwd)), { uid: 0, mode: 0o040755 })
        : lstat(value, options),
  );
  syncBuiltinESMExports();
  for (const [values, expected] of [
    [
      [
        ['credential', helper],
        ['credential "https://github.com"', ''],
        ['credential', helper],
      ],
      true,
    ],
    [
      [
        ['credential', ''],
        ['credential "https://github.com"', helper],
        ['credential', ''],
      ],
      false,
    ],
  ] as const) {
    await writeFile(
      configPath,
      initialConfig + values.map(([section, value]) => `\n[${section}]\nhelper = ${value}\n`).join(''),
    );
    if (fs.existsSync(marker)) await fs.promises.unlink(marker);
    let reached = false;
    const run = (args: string[], cwd: string, transport = false) =>
      runGit(args, cwd, transport, async (file, actual, options) => {
        const index = actual.indexOf('ls-remote');
        if (index < 0) return runProcess(file, actual, options);
        reached = true;
        const credentialArgs = [
          ...actual.slice(0, index).map((value) => value.replaceAll(path, script.replaceAll('\\', '/'))),
          'credential',
          'fill',
        ];
        if (expected)
          assert.match(
            await runProcess(file, credentialArgs, { ...options, input: 'protocol=https\nhost=github.com\n\n' }),
            /username=test/,
          );
        else
          await assert.rejects(
            runProcess(file, credentialArgs, { ...options, input: 'protocol=https\nhost=github.com\n\n' }),
          );
        assert.equal(fs.existsSync(marker), expected);
        return `ref: refs/heads/main\tHEAD\n${head}\tHEAD\n`;
      });
    await safePush({ branch, dryRun: true }, f.cwd, run);
    assert.ok(reached);
  }
});

await test('SGT-U31: Node と外部プロセスの起動前に native loader の環境変数を除去する', async (t) => {
  const skill = await read(join(repository, '.agents/skills/safe-git/SKILL.md'));
  const shell = /```sh\r?\n([\s\S]*?)```/.exec(skill)?.[1];
  assert.ok(shell);
  assert.doesNotMatch(shell, /\/usr\/bin\/env/);
  assert.ok(shell.includes('unset NODE_OPTIONS NODE_PATH GLIBC_TUNABLES'));
  for (const prefix of ['LD_', 'DYLD_', '_RLD_', 'RLD_', 'LDR_'])
    assert.ok(shell.slice(0, shell.indexOf('/usr/bin/node')).includes('${!' + prefix + '@}'));
  const root = await temporaryDirectory(t);
  const probe = join(root, 'environment.ts');
  await writeFile(
    probe,
    `console.log(JSON.stringify(Object.keys(process.env).filter((key) => /^(LD_|DYLD_|_?RLD_|LDR_)|^(NODE_OPTIONS|NODE_PATH|GLIBC_TUNABLES)$/.test(key))));`,
  );
  const clean = shell.slice(0, shell.indexOf('/usr/bin/node'));
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
  const quote = (value: string) => "'" + value.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";
  const polluted =
    'export LD_PRELOAD=/untrusted LD_LIBRARY_PATH=/untrusted LD_AUDIT=/untrusted LD_OTHER=/untrusted DYLD_INSERT_LIBRARIES=/untrusted DYLD_LIBRARY_PATH=/untrusted DYLD_OTHER=/untrusted _RLD_LIST=/untrusted RLD_LIST=/untrusted LDR_PRELOAD=/untrusted GLIBC_TUNABLES=/untrusted NODE_OPTIONS=--untrusted NODE_PATH=/untrusted\n';
  const result = spawnSync(bash, ['-c', polluted + clean + quote(process.execPath) + ' ' + quote(probe)], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), []);
  const readonly = spawnSync(
    bash,
    ['-c', 'readonly LD_PRELOAD=/untrusted\n' + clean + quote(process.execPath) + ' ' + quote(probe)],
    { encoding: 'utf8' },
  );
  assert.equal(readonly.status, 1, readonly.stderr);
  assert.equal(readonly.stdout, '', '環境変数を除去できないときは Node を起動しない');
  if (process.platform === 'linux') {
    const marker = join(root, 'native-preloaded');
    const source = join(root, 'preload.c');
    const library = join(root, 'preload.so');
    await writeFile(
      source,
      `#include <stdio.h>\n__attribute__((constructor)) static void loaded(void) { FILE *f = fopen(${JSON.stringify(marker)}, "w"); if(f) { fputs("executed", f); fclose(f); } }\n`,
    );
    const compiled = spawnSync('cc', ['-shared', '-fPIC', '-o', library, source], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
    const baseline = spawnSync('/usr/bin/env', ['-u', 'LD_PRELOAD', process.execPath, '-e', ''], {
      env: { ...process.env, LD_PRELOAD: library },
      encoding: 'utf8',
    });
    assert.equal(baseline.status, 0, baseline.stderr);
    assert.equal(await read(marker), 'executed');
    await fs.promises.unlink(marker);
    const native = spawnSync(
      bash,
      ['-c', 'export LD_PRELOAD=' + quote(library) + '\n' + clean + quote(process.execPath) + ' ' + quote(probe)],
      { encoding: 'utf8' },
    );
    assert.equal(native.status, 0, native.stderr);
    assert.equal(fs.existsSync(marker), false);
  }
  const env = { ...process.env };
  try {
    process.env.LD_PRELOAD = '/untrusted/library';
    process.env.DYLD_INSERT_LIBRARIES = '/untrusted/library';
    await runGit(['rev-parse', '--show-toplevel'], repository, false, async (_file, _args, options) => {
      assert.equal(options.env?.LD_PRELOAD, undefined);
      assert.equal(options.env?.DYLD_INSERT_LIBRARIES, undefined);
      return repository;
    });
  } finally {
    process.env = env;
  }
});
