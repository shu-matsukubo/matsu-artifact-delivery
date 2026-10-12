import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { read, repository, temporaryDirectory } from '../lib/plugin.ts';

const publish = await read(join(repository, '.agents/skills/scheduled-issue-processing/references/publish-pr.md'));
const commands = [...publish.matchAll(/`(git [^`]+)`/g)].map((match) => match[1]!);
const commits = commands.filter((command) => /\bcommit /.test(command));
const pushes = commands.filter((command) => /\bpush /.test(command));
assert.equal(commits.length, 2);
assert.equal(pushes.length, 2);

// 手順書のプレースホルダーだけを置換し、シェルを介さず実際の Git に渡す。
function argumentsFor(command: string, branch = 'scheduled-test') {
  return command
    .replaceAll('<生成したコミットメッセージ>', 'scheduled test')
    .replaceAll('<Issue 用ブランチ>', branch)
    .match(/"[^"]*"|\S+/g)!
    .slice(1)
    .map((argument) => argument.replace(/^"|"$/g, ''));
}

async function fixture(t: TestContext) {
  const root = await temporaryDirectory(t);
  const local = join(root, 'local');
  const remote = join(root, 'remote.git');
  const template = join(root, 'template');
  await mkdir(local);
  await mkdir(template);
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
    GIT_CONFIG_COUNT: '0',
    GIT_TEMPLATE_DIR: template,
    GIT_AUTHOR_NAME: 'Scheduled test',
    GIT_AUTHOR_EMAIL: 'scheduled@example.invalid',
    GIT_COMMITTER_NAME: 'Scheduled test',
    GIT_COMMITTER_EMAIL: 'scheduled@example.invalid',
  };
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: local, env, encoding: 'utf8', stdio: 'pipe', timeout: 10000 }).trim();
  const put = (name: string, content: string) => writeFile(join(local, name), content);
  git('init', '--initial-branch=work');
  git('init', '--bare', remote);
  git('remote', 'add', 'origin', remote);
  await put('reviewed.txt', 'base\n');
  git('add', '--', 'reviewed.txt');
  git('commit', '--no-gpg-sign', '-m', 'base');
  return { local, remote, git, put };
}

await test('SCH-U03: 公開用と同期用のコミットはフックによる未レビュー差分を含めない', async (t) => {
  const { local, git, put } = await fixture(t);
  const hooks = join(local, '.git/hooks');
  await mkdir(hooks, { recursive: true });
  git('config', 'core.hooksPath', hooks);
  for (const hook of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit']) {
    await writeFile(
      join(hooks, hook),
      '#!/bin/sh\nprintf "hook ran\\n" >> unreviewed.txt\ngit add -- unreviewed.txt\n',
      { mode: 0o755 },
    );
  }
  for (const [index, command] of commits.entries()) {
    await put('reviewed.txt', `reviewed ${index}\n`);
    git('add', '--', 'reviewed.txt');
    const reviewedTree = git('write-tree');
    git(...argumentsFor(command));
    assert.equal(git('rev-parse', 'HEAD^{tree}'), reviewedTree);
    assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '');
    assert.equal(git('config', 'core.hooksPath'), hooks);
  }
});

await test('SCH-U04: 公開用と同期用のコミットは利用不能な署名設定を引き継がない', async (t) => {
  const { git, put } = await fixture(t);
  git('config', '--global', 'commit.gpgSign', 'true');
  git('config', '--global', 'gpg.program', 'unavailable-scheduled-test-signer');
  for (const [index, command] of commits.entries()) {
    await put('reviewed.txt', `reviewed ${index}\n`);
    git('add', '--', 'reviewed.txt');
    git(...argumentsFor(command));
    assert.doesNotMatch(git('cat-file', 'commit', 'HEAD'), /^gpgsig /m);
    assert.equal(git('config', 'commit.gpgSign'), 'true');
  }
});

await test('SCH-U05: 新規・再開 Push はタグを公開せず、競合と非 fast-forward を拒否する', async (t) => {
  const { remote, git, put } = await fixture(t);
  const refs = () => git('--git-dir', remote, 'for-each-ref', '--format=%(refname) %(objectname)');
  git('config', '--global', 'push.followTags', 'true');
  git('tag', '-a', 'pending-tag', '-m', 'pending');
  git(...argumentsFor(pushes[0]!));
  assert.equal(refs(), `refs/heads/scheduled-test ${git('rev-parse', 'HEAD')}`);
  const published = refs();
  await put('reviewed.txt', 'resumed\n');
  git('add', '--', 'reviewed.txt');
  git('commit', '--no-gpg-sign', '-m', 'resumed');
  assert.throws(() => git(...argumentsFor(pushes[0]!)));
  assert.equal(refs(), published);
  git(...argumentsFor(pushes[1]!));
  assert.equal(refs(), `refs/heads/scheduled-test ${git('rev-parse', 'HEAD')}`);
  const resumed = refs();
  git('switch', '-c', 'diverged', 'HEAD~1');
  await put('reviewed.txt', 'diverged\n');
  git('add', '--', 'reviewed.txt');
  git('commit', '--no-gpg-sign', '-m', 'diverged');
  assert.throws(() => git(...argumentsFor(pushes[1]!)));
  assert.equal(refs(), resumed);
  assert.equal(git('config', 'push.followTags'), 'true');
});
