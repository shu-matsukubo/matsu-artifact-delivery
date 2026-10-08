import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { parseArguments, safePush } from '../../.agents/skills/safe-git/scripts/push.ts';
import { frontmatter, localLinks, read, repository, temporaryDirectory } from '../lib/plugin.ts';

const url = 'https://github.com/shu-matsukubo/matsu-artifact-delivery.git';
const branch = 'codex/issue-51';
const head = 'a'.repeat(40);
type Run = (args: string[], cwd: string) => string;

function fixture(root = repository) {
  const calls: string[][] = [];
  const replies = new Map<string, string>([
    ['rev-parse --show-toplevel', root],
    ['symbolic-ref --quiet --short HEAD', branch],
    ['status --porcelain=v1 --untracked-files=all', ''],
    ['rev-parse --verify HEAD^{commit}', head],
    ['remote get-url --all origin', url],
    ['remote get-url --push --all origin', url],
    ['config --name-only --list', ''],
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

await test('SGT-U01: Push は検証済み URL と単一の commit:branch を使い、dry-run は更新しない', () => {
  const { run, calls } = fixture();
  const plan = safePush({ branch, dryRun: true }, repository, run);
  assert.equal(plan.commit, head);
  assert.equal(plan.branch, branch);
  assert.equal(
    calls.some((args) => args.includes('push')),
    false,
  );
  safePush({ branch, dryRun: false }, repository, run);
  const push = calls.find((args) => args.includes('push'))!;
  assert.deepEqual(push.slice(-3), ['--', url, `${head}:refs/heads/${branch}`]);
  for (const option of ['--no-verify', '--no-follow-tags', '--recurse-submodules=no']) assert.ok(push.includes(option));
  assert.ok(!push.some((arg) => /force|mirror|delete|all|tags$/.test(arg) && arg !== '--no-follow-tags'));
});

await test('SGT-U02: 入力・リポジトリ・作業状態・接続先の不一致では Push しない', () => {
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
    ['status --porcelain=v1 --untracked-files=all', '?? unreviewed.ts'],
    ['remote get-url --all origin', 'https://github.com/other/repository.git'],
    ['remote get-url --push --all origin', 'https://github.com/attacker/repo.git'],
    ['remote get-url --push --all origin', `${url}\n${url}`],
    ['remote get-url --push --all origin', 'ext::command'],
    ['config --name-only --list', 'url.ssh://attacker/.pushinsteadof'],
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
    assert.throws(() => safePush({ branch, dryRun: false }, repository, run), command);
    assert.equal(
      f.calls.some((args) => args.includes('push')),
      false,
      command,
    );
  }
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
  safePush({ branch, dryRun: true }, f.cwd, f.run);
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`), '');
  safePush({ branch, dryRun: false }, f.cwd, f.run);
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`).split('\t')[0], f.commit);
  assert.equal(f.git('ls-remote', f.remote, 'refs/heads/main').split('\t')[0], f.base);
  assert.equal(f.git('ls-remote', f.remote, 'refs/tags/*'), '');
  await writeFile(join(f.cwd, 'file'), 'next');
  f.git('commit', '-qam', 'next');
  safePush({ branch, dryRun: false }, f.cwd, f.run);
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`).split('\t')[0], f.git('rev-parse', 'HEAD'));
});

await test('SGT-U06: CLI は未知の引数・別 cwd・Git 設定の環境変数を終了コード 1 で拒否する', () => {
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

await test('SGT-U04: non-fast-forward・Git 失敗は成功扱いせず、remote を変更しない', async (t) => {
  const f = await gitFixture(t);
  safePush({ branch, dryRun: false }, f.cwd, f.run);
  f.git('switch', '-c', 'diverged', f.base);
  await writeFile(join(f.cwd, 'file'), 'diverged');
  f.git('commit', '-qam', 'diverged');
  f.git('branch', '-f', branch, 'HEAD');
  f.git('switch', branch);
  assert.throws(() => safePush({ branch, dryRun: false }, f.cwd, f.run));
  assert.equal(f.git('ls-remote', f.remote, `refs/heads/${branch}`).split('\t')[0], f.commit);
  const run: Run = (args, cwd) => {
    if (args.includes('push')) throw new Error('Push rejected');
    return f.run(args, cwd);
  };
  f.git('switch', '-c', 'fresh-branch');
  assert.throws(() => safePush({ branch: 'fresh-branch', dryRun: false }, f.cwd, run), /Push rejected/);
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
    ['git', '-C', '.', 'push'],
    ['git', 'send-pack', url],
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
