import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { read, repository, temporaryDirectory } from '../lib/plugin.ts';

const publish = await read(join(repository, '.agents/skills/scheduled-issue-processing/references/publish-pr.md'));
const operations = await read(
  join(repository, '.agents/skills/scheduled-issue-processing/references/git-operations.md'),
);
const prefix = /`(git [^`]+)`/.exec(operations)![1]!;
const table = new Map(
  [...operations.matchAll(/^\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|$/gm)].map((match) => [match[1]!, match[2]!]),
);
function command(name: string) {
  const args = table.get(name);
  assert.ok(args, `操作が未定義: ${name}`);
  return `${prefix} ${args}`;
}
const commits = [command('コミット')];
const pushes = [command('新規 Push'), command('再開 Push')];
const stages = [command('ステージ')];
const workspace = await read(
  join(repository, '.agents/skills/scheduled-issue-processing/references/workspace-setup.md'),
);
const setup = [command('worktree 作成'), command('ブランチ作成')];
const statuses = [command('clean の確認')];

// 引数の境界を先に決め、値をシェルコードとして解釈せず実際の Git に渡す。
function argumentsFor(command: string, branch = 'scheduled-test', replacements: Record<string, string> = {}) {
  return command
    .match(/"[^"]*"|(?:<[^>]+>|[^\s"<])+/g)!
    .slice(1)
    .map((argument) => {
      argument = argument.replace(/^"|"$/g, '');
      for (const [placeholder, value] of Object.entries({
        '<生成したコミットメッセージ>': 'scheduled test',
        '<Issue 用ブランチ>': branch,
        ...replacements,
      }))
        argument = argument.replaceAll(placeholder, value);
      return argument;
    });
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
  return { root, local, remote, git, put };
}

async function submoduleFixture(t: TestContext) {
  const result = await fixture(t);
  const { root, local, git } = result;
  const source = join(root, 'submodule-source');
  const subRemote = join(root, 'submodule.git');
  const dependency = join(local, 'dependency');
  git('switch', '-c', 'scheduled-test');
  await mkdir(source);
  git('-C', source, 'init', '--initial-branch=scheduled-test');
  await writeFile(join(source, 'child.txt'), 'base\n');
  git('-C', source, 'add', '--', 'child.txt');
  git('-C', source, 'commit', '--no-gpg-sign', '-m', 'child base');
  git('init', '--bare', subRemote);
  git('-C', source, 'remote', 'add', 'origin', subRemote);
  git('-C', source, 'push', 'origin', 'HEAD:refs/heads/scheduled-test');
  git('-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'dependency');
  git('-C', dependency, 'remote', 'set-url', 'origin', subRemote);
  git('commit', '--no-gpg-sign', '-m', 'add dependency');
  return { ...result, source, subRemote, dependency };
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
  for (const [index, commitCommand] of commits.entries()) {
    await put('reviewed.txt', `reviewed ${index}\n`);
    git('add', '--', 'reviewed.txt');
    const reviewedTree = git(...argumentsFor(command('index の tree')));
    git(...argumentsFor(commitCommand));
    assert.equal(git(...argumentsFor(command('HEAD の tree'))), reviewedTree);
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
  const initial = git('rev-parse', 'HEAD');
  assert.equal(refs(), `refs/heads/scheduled-test ${git('rev-parse', 'HEAD')}`);
  const published = refs();
  await put('reviewed.txt', 'resumed\n');
  git('add', '--', 'reviewed.txt');
  git('commit', '--no-gpg-sign', '-m', 'resumed');
  assert.throws(() => git(...argumentsFor(pushes[0]!)));
  assert.equal(refs(), published);
  git(...argumentsFor(command('再開の祖先確認'), 'scheduled-test', { '<確認したリモート先端 SHA>': initial }));
  git(...argumentsFor(pushes[1]!, 'scheduled-test', { '<確認したリモート先端 SHA>': initial }));
  assert.equal(refs(), `refs/heads/scheduled-test ${git('rev-parse', 'HEAD')}`);
  const resumed = refs();
  const resumedTip = git('rev-parse', 'HEAD');
  git('switch', '-c', 'diverged', 'HEAD~1');
  await put('reviewed.txt', 'diverged\n');
  git('add', '--', 'reviewed.txt');
  git('commit', '--no-gpg-sign', '-m', 'diverged');
  assert.throws(() =>
    git(...argumentsFor(command('再開の祖先確認'), 'scheduled-test', { '<確認したリモート先端 SHA>': resumedTip })),
  );
  assert.equal(refs(), resumed);
  assert.equal(git('config', 'push.followTags'), 'true');
});

await test('SCH-U06: worktree 作成とブランチ切り替えは checkout フックによる変更を含めない', async (t) => {
  const { root, local, git } = await fixture(t);
  const hooks = join(local, '.git/hooks');
  const isolated = join(root, 'isolated worktree');
  await mkdir(hooks, { recursive: true });
  git('config', 'core.hooksPath', hooks);
  await writeFile(join(hooks, 'post-checkout'), '#!/bin/sh\nprintf "hook ran\\n" >> unreviewed.txt\n', {
    mode: 0o755,
  });
  const base = git('rev-parse', 'HEAD');
  const replacements = { '<未使用の絶対パス>': isolated, '<取得したコミット SHA>': base };
  git(...argumentsFor(setup[0]!, 'scheduled-test', replacements));
  assert.equal(git('-C', isolated, 'rev-parse', 'HEAD'), base);
  assert.equal(git('-C', isolated, 'status', '--porcelain=v1', '--untracked-files=all'), '');
  git('-C', isolated, ...argumentsFor(setup[1]!, 'scheduled-test', replacements));
  assert.equal(git('-C', isolated, 'branch', '--show-current'), 'scheduled-test');
  assert.equal(git('-C', isolated, 'rev-parse', 'HEAD'), base);
  assert.equal(git('-C', isolated, 'status', '--porcelain=v1', '--untracked-files=all'), '');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '');
  assert.equal(git('config', 'core.hooksPath'), hooks);
});

await test('SCH-U07: 新規・再開 Push は pre-push フックによる変更と別ブランチの公開を防ぐ', async (t) => {
  const { local, remote, git, put } = await fixture(t);
  const hooks = join(local, '.git/hooks');
  await mkdir(hooks, { recursive: true });
  git('config', 'core.hooksPath', hooks);
  await writeFile(
    join(hooks, 'pre-push'),
    '#!/bin/sh\nprintf "hook ran\\n" >> unreviewed.txt\ngit add -- unreviewed.txt\ngit push --no-verify origin HEAD:refs/heads/unreviewed-branch\n',
    { mode: 0o755 },
  );
  for (const [index, command] of pushes.entries()) {
    const expected = index === 1 ? git('--git-dir', remote, 'rev-parse', 'refs/heads/scheduled-test') : '';
    await put('reviewed.txt', `reviewed ${index}\n`);
    git('add', '--', 'reviewed.txt');
    git(...argumentsFor(commits[0]!));
    git(...argumentsFor(command, 'scheduled-test', { '<確認したリモート先端 SHA>': expected }));
    assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '');
    assert.equal(
      git('--git-dir', remote, 'for-each-ref', '--format=%(refname) %(objectname)'),
      `refs/heads/scheduled-test ${git('rev-parse', 'HEAD')}`,
    );
    assert.equal(git('config', 'core.hooksPath'), hooks);
  }
});

await test('SCH-U08: 新規・再開 Push は利用不能な Push 署名設定を引き継がない', async (t) => {
  const { remote, git, put } = await fixture(t);
  git('config', '--global', 'push.gpgSign', 'true');
  git('config', '--global', 'gpg.program', 'unavailable-scheduled-test-signer');
  for (const [index, command] of pushes.entries()) {
    const expected = index === 1 ? git('--git-dir', remote, 'rev-parse', 'refs/heads/scheduled-test') : '';
    await put('reviewed.txt', `reviewed ${index}\n`);
    git('add', '--', 'reviewed.txt');
    git(...argumentsFor(commits[0]!));
    git(...argumentsFor(command, 'scheduled-test', { '<確認したリモート先端 SHA>': expected }));
    assert.equal(git('--git-dir', remote, 'rev-parse', 'refs/heads/scheduled-test'), git('rev-parse', 'HEAD'));
    assert.equal(git('config', 'push.gpgSign'), 'true');
  }
});

await test('SCH-U09: 新規 worktree は元のリポジトリ外に配置し、作成と切り替えの後に clean を確認する', () => {
  assert.match(workspace, /元のリポジトリ外.*未使用の絶対パス/);
  assert.match(workspace, /worktree 作成後とブランチ切り替え後.*\(git-operations\.md\).*clean/);
});

await test('SCH-U10: 新規 Git 公開の強制 Push は対象と影響への明示的承認を必要とする', () => {
  assert.match(publish, /Plugin \/ API 経路.*ref 作成.*既存 ref.*失敗/);
  assert.match(publish, /Git 経路.*対象と影響.*ユーザーの明示的な承認を得た場合だけ.*新規 Push/);
  assert.match(publish, /`--force-with-lease` の承認として、スケジューラの起動や `AI処理可能` ラベルを扱わない/);
  assert.match(publish, /承認がない場合は Plugin \/ API 経路.*利用できなければ停止/);
});

await test('SCH-U11: 新規 Push は同一 SHA の既存 ref への no-op を新規作成として扱わない', async (t) => {
  const { remote, git } = await fixture(t);
  const created = /^\*\tHEAD:refs\/heads\/scheduled-test\t/m;
  assert.match(git(...argumentsFor(pushes[0]!)), created);
  const published = git('--git-dir', remote, 'for-each-ref', '--format=%(refname) %(objectname)');
  const unchanged = git(...argumentsFor(pushes[0]!));
  assert.match(unchanged, /^=\tHEAD:refs\/heads\/scheduled-test\t/m);
  assert.doesNotMatch(unchanged, created);
  assert.equal(git('--git-dir', remote, 'for-each-ref', '--format=%(refname) %(objectname)'), published);
  assert.match(publish, /新規公開.*--porcelain.*対象 ref の行が `\*`.*新規作成.*`=`.*up to date.*停止/);
});

await test('SCH-U12: 公開・同期のステージはファイル名を literal に扱い、類似名の未レビュー変更を含めない', async (t) => {
  const { git, put } = await fixture(t);
  for (const [index, command] of stages.entries()) {
    const reviewed = `file[${index}].txt`;
    const unreviewed = `file${index}.txt`;
    await put(reviewed, 'reviewed\n');
    await put(unreviewed, 'unreviewed\n');
    git(...argumentsFor(command, 'scheduled-test', { '<レビュー済みパス>...': reviewed }));
    assert.equal(git('diff', '--cached', '--name-only'), reviewed);
    git(...argumentsFor(commits[0]!));
  }
});

await test('SCH-U13: 新規・再開 Push は submodule の別リモートを更新しない', async (t) => {
  for (const [index, command] of pushes.entries()) {
    const { subRemote, dependency, remote, git } = await submoduleFixture(t);
    if (index === 1) git(...argumentsFor(pushes[0]!));
    const expected = index === 1 ? git('--git-dir', remote, 'rev-parse', 'refs/heads/scheduled-test') : '';
    const previous = git('--git-dir', subRemote, 'for-each-ref', '--format=%(refname) %(objectname)');
    await writeFile(join(dependency, 'child.txt'), 'reviewed child\n');
    git('-C', dependency, 'add', '--', 'child.txt');
    git('-C', dependency, 'commit', '--no-gpg-sign', '-m', 'child update');
    git('add', '--', 'dependency');
    git(...argumentsFor(commits[0]!));
    git('config', '--global', 'push.recurseSubmodules', 'on-demand');
    git(...argumentsFor(command, 'scheduled-test', { '<確認したリモート先端 SHA>': expected }));
    assert.equal(git('--git-dir', subRemote, 'for-each-ref', '--format=%(refname) %(objectname)'), previous);
    assert.equal(git('--git-dir', remote, 'rev-parse', 'refs/heads/scheduled-test'), git('rev-parse', 'HEAD'));
    assert.equal(git('config', 'push.recurseSubmodules'), 'on-demand');
  }
});

await test('SCH-U14: すべての clean 確認は stale な fsmonitor による変更の見落としを防ぐ', async (t) => {
  for (const command of statuses) {
    const { root, git, put } = await fixture(t);
    const monitor = join(root, 'fsmonitor').replaceAll('\\', '/');
    await writeFile(monitor, '#!/bin/sh\nprintf "unchanged-token\\000"\n', { mode: 0o755 });
    git('config', 'core.fsmonitor', monitor);
    git('config', 'core.fsmonitorHookVersion', '2');
    git('status', '--porcelain=v1', '--untracked-files=all');
    git('status', '--porcelain=v1', '--untracked-files=all');
    await put('reviewed.txt', 'edit\n');
    assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '');
    assert.match(git(...argumentsFor(command)), /M reviewed\.txt/);
    assert.equal(git('config', 'core.fsmonitor'), monitor);
  }
});

await test('SCH-U15: clean 判定の前に変更を隠す index フラグを検出し、既存フラグを保全する', async (t) => {
  for (const flag of ['assume-unchanged', 'skip-worktree']) {
    const { git, put } = await fixture(t);
    git('update-index', `--${flag}`, 'reviewed.txt');
    await put('reviewed.txt', 'hidden edit\n');
    assert.equal(git(...argumentsFor(statuses[0]!)), '');
    const entries = git(...argumentsFor(command('index の確認')))
      .split('\0')
      .filter(Boolean);
    assert.ok(entries.some((entry) => /^[a-zS] /.test(entry)));
    assert.match(git('ls-files', '-v'), /^[a-zS] reviewed\.txt$/);
  }
  assert.match(operations, /先に index の確認.*先頭が小文字.*`S`.*停止.*フラグを自動解除しない/s);
});

await test('SCH-U16: clean 確認は設定で隠された submodule 内の変更を検出する', async (t) => {
  const { dependency, git } = await submoduleFixture(t);
  git('config', 'diff.ignoreSubmodules', 'all');
  git('config', 'submodule.dependency.ignore', 'all');
  await writeFile(join(dependency, 'child.txt'), 'dirty child\n');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '');
  assert.match(git(...argumentsFor(statuses[0]!)), /M dependency/);
  assert.equal(git('config', 'submodule.dependency.ignore'), 'all');
  for (const flag of ['assume-unchanged', 'skip-worktree']) {
    git('-C', dependency, 'update-index', `--${flag}`, 'child.txt');
    assert.equal(git(...argumentsFor(statuses[0]!)), '');
    assert.match(git('-C', dependency, ...argumentsFor(command('index の確認'))), /^[a-zS] child\.txt\0$/);
  }
  assert.match(operations, /対象作業ツリーと初期化済み submodule のそれぞれで先に index の確認/);
});

await test('SCH-U18: 起点の取得はタグの取得・削除と submodule の再帰取得を設定から引き継がない', async (t) => {
  const { root, source, subRemote, remote, git } = await submoduleFixture(t);
  git(...argumentsFor(pushes[0]!));
  const expected = git('rev-parse', 'HEAD');
  const receiver = join(root, 'receiver');
  git('clone', remote, receiver);
  git('-C', receiver, 'switch', 'scheduled-test');
  git('-C', receiver, '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init');
  const child = join(receiver, 'dependency');
  const oldChild = git('-C', child, 'rev-parse', 'HEAD');
  await writeFile(join(source, 'child.txt'), 'new remote child\n');
  git('-C', source, 'add', '--', 'child.txt');
  git('-C', source, 'commit', '--no-gpg-sign', '-m', 'new remote child');
  const newChild = git('-C', source, 'rev-parse', 'HEAD');
  git('-C', source, 'push', 'origin', 'HEAD:refs/heads/scheduled-test');
  assert.equal(git('--git-dir', subRemote, 'rev-parse', 'refs/heads/scheduled-test'), newChild);
  git('update-index', '--cacheinfo', `160000,${newChild},dependency`);
  git(...argumentsFor(commits[0]!));
  git('tag', 'remote-tag');
  git('push', 'origin', 'refs/tags/remote-tag');
  git(...argumentsFor(pushes[1]!, 'scheduled-test', { '<確認したリモート先端 SHA>': expected }));
  const base = git('rev-parse', 'HEAD');
  git('-C', receiver, 'tag', 'local-tag');
  git('-C', receiver, 'config', 'remote.origin.tagOpt', '--tags');
  git('-C', receiver, 'config', 'fetch.prune', 'true');
  git('-C', receiver, 'config', 'fetch.pruneTags', 'true');
  git('-C', receiver, 'config', 'fetch.recurseSubmodules', 'true');
  assert.throws(() => git('-C', child, 'cat-file', '-e', newChild));
  git('-C', receiver, ...argumentsFor(command('起点の取得'), 'scheduled-test', { '<取得したコミット SHA>': base }));
  assert.equal(git('-C', receiver, 'rev-parse', 'FETCH_HEAD'), base);
  assert.equal(git('-C', receiver, 'tag', '--list'), 'local-tag');
  assert.equal(git('-C', child, 'rev-parse', 'HEAD'), oldChild);
  assert.throws(() => git('-C', child, 'cat-file', '-e', newChild));
  assert.equal(git('-C', receiver, 'config', 'fetch.recurseSubmodules'), 'true');
});

await test('SCH-U17: ステージはフックを実行せず、差分照合は外部 diff に隠されず index 全体を示す', async (t) => {
  const { root, local, git, put } = await fixture(t);
  await put('unreviewed.txt', 'already staged\n');
  git('add', '--', 'unreviewed.txt');
  const hooks = join(local, '.git/hooks');
  await mkdir(hooks, { recursive: true });
  git('config', 'core.hooksPath', hooks);
  await writeFile(join(hooks, 'post-index-change'), '#!/bin/sh\nprintf "hook ran\\n" > hook-marker\n', {
    mode: 0o755,
  });
  const external = join(root, 'external-diff').replaceAll('\\', '/');
  await writeFile(external, '#!/bin/sh\nprintf "external ran\\n" > external-marker\n', { mode: 0o755 });
  git('config', 'diff.external', external);
  git('config', 'diff.test.textconv', external);
  await put('.gitattributes', '*.txt diff=test\n');
  await put('reviewed.txt', 'reviewed edit\n');
  git(...argumentsFor(stages[0]!, 'scheduled-test', { '<レビュー済みパス>...': 'reviewed.txt' }));
  const diff = git(...argumentsFor(command('ステージ全体の差分')));
  assert.match(diff, /\+reviewed edit/);
  assert.match(diff, /\+already staged/);
  assert.equal(await read(join(local, 'unreviewed.txt')), 'already staged\n');
  assert.doesNotMatch(git(...argumentsFor(statuses[0]!)), /hook-marker|external-marker/);
});

await test('SCH-U19: 接続先の確認は全 Push URL と URL 書き換え後の取得先を列挙する', async (t) => {
  const { root, remote, git } = await fixture(t);
  const other = join(root, 'other.git');
  git('init', '--bare', other);
  git('config', '--add', 'remote.origin.pushurl', remote);
  git('config', '--add', 'remote.origin.pushurl', other);
  assert.deepEqual(git(...argumentsFor(command('Push 先の確認'))).split('\n'), [remote, other]);
  git('config', 'url.alias-target.insteadOf', remote);
  assert.equal(git(...argumentsFor(command('取得先の確認'))), 'alias-target');
  assert.match(operations, /Push 前.*Push 先の確認.*1 件.*対象リポジトリ/s);
  assert.match(operations, /複数.*不一致.*停止/s);
});

await test('SCH-U20: 再開 Push は確認後の ref 削除・置換を拒否し、既存 ref だけを更新する', async (t) => {
  const { remote, git, put } = await fixture(t);
  git(...argumentsFor(pushes[0]!));
  const expected = git('rev-parse', 'HEAD');
  await put('reviewed.txt', 'resumed\n');
  git('add', '--', 'reviewed.txt');
  git(...argumentsFor(commits[0]!));
  const replacements = { '<確認したリモート先端 SHA>': expected };
  git(...argumentsFor(command('再開の祖先確認'), 'scheduled-test', replacements));
  const resume = argumentsFor(pushes[1]!, 'scheduled-test', replacements);
  git('--git-dir', remote, 'update-ref', '-d', 'refs/heads/scheduled-test');
  assert.throws(() => git(...resume));
  assert.equal(git('--git-dir', remote, 'for-each-ref'), '');
  const replaced = git('commit-tree', 'HEAD^{tree}', '-p', expected, '-m', 'concurrent update');
  git('push', 'origin', `${replaced}:refs/heads/scheduled-test`);
  assert.throws(() => git(...resume));
  assert.equal(git('--git-dir', remote, 'rev-parse', 'refs/heads/scheduled-test'), replaced);
  git('--git-dir', remote, 'update-ref', 'refs/heads/scheduled-test', expected);
  git(...resume);
  assert.equal(git('--git-dir', remote, 'rev-parse', 'refs/heads/scheduled-test'), git('rev-parse', 'HEAD'));
  assert.match(publish, /既存ブランチ.*先端 SHA.*祖先.*条件付き fast-forward 更新/s);
  assert.match(publish, /`beforeOid`.*空でない SHA.*`afterOid`.*レビュー済みコミット SHA.*`force`.*`false`/);
  assert.match(publish, /Git 経路.*対象と影響.*ユーザーの明示的な承認.*再開の祖先確認と再開 Push/);
});

await test('SCH-U21: 差分確認を含む共通の Git 操作は pager を起動しない', () => {
  assert.ok(argumentsFor(prefix).includes('--no-pager'));
});

await test('SCH-U22: worktree と tree の確認は置換 ref による別内容を採用しない', async (t) => {
  const { root, git, put } = await fixture(t);
  const base = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  await put('reviewed.txt', 'replacement\n');
  git('add', '--', 'reviewed.txt');
  git('commit', '--no-gpg-sign', '-m', 'replacement');
  const replacement = git('rev-parse', 'HEAD');
  git('replace', base, replacement);
  const isolated = join(root, 'isolated');
  git(
    ...argumentsFor(setup[0]!, 'scheduled-test', {
      '<未使用の絶対パス>': isolated,
      '<取得したコミット SHA>': base,
    }),
  );
  assert.equal(git('-C', isolated, 'rev-parse', 'HEAD'), base);
  assert.equal(await read(join(isolated, 'reviewed.txt')), 'base\n');
  assert.equal(git('-C', isolated, ...argumentsFor(command('HEAD の tree'))), tree);
  assert.equal(git('-C', isolated, ...argumentsFor(statuses[0]!)), '');
  assert.equal(git('replace', '-l'), base);
});

await test('SCH-U23: 設定由来のブランチ名とパスは値を展開せず一つの引数として渡す', async (t) => {
  const { git } = await fixture(t);
  const branch = 'codex;echo${IFS}marker;#/scheduled/issue/1';
  git('check-ref-format', '--branch', branch);
  git(...argumentsFor(setup[1]!, branch, { '<取得したコミット SHA>': git('rev-parse', 'HEAD') }));
  assert.equal(git('branch', '--show-current'), branch);
  git(...argumentsFor(pushes[0]!, branch));
  assert.equal(git('ls-remote', 'origin', `refs/heads/${branch}`).split('\t')[1], `refs/heads/${branch}`);
  assert.match(operations, /すべてのプレースホルダー.*引数配列.*シェル/s);
  assert.match(operations, /ブランチ名.*refspec.*コミットメッセージ.*パス/s);
});
