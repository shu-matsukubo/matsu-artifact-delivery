import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCompleteResponse,
  assertCompleteStatuses,
  evaluateChecks,
  waitForPullRequest,
  type CheckRun,
} from '../../.agents/skills/issue-development-workflow/scripts/wait-ci.ts';

const successful = (name: string): CheckRun => ({ name, status: 'completed', conclusion: 'success' });

await test('CI-GATE-U01: 空・未起動・Quality gate 欠落を待機し、必須ゲート成功を要求する', async () => {
  assert.equal(evaluateChecks([]).state, 'waiting');
  assert.equal(evaluateChecks([successful('Unit')]).state, 'waiting');
  assert.equal(evaluateChecks([{ name: 'Quality gate', status: 'in_progress', conclusion: null }]).state, 'waiting');
  assert.equal(
    evaluateChecks([successful('Quality gate'), { name: 'E2E', status: 'queued', conclusion: null }]).state,
    'waiting',
  );
  assert.equal(evaluateChecks([successful('Quality gate'), successful('Unit')]).state, 'success');
  assert.equal(
    evaluateChecks([
      successful('Quality gate'),
      { name: 'Unit / ubuntu / Node 22', status: 'completed', conclusion: 'skipped' },
    ]).state,
    'success',
  );
  assert.equal(evaluateChecks([{ name: 'Quality gate', status: 'completed', conclusion: 'neutral' }]).state, 'failure');
  assert.equal(evaluateChecks([{ name: 'Quality gate', status: 'completed', conclusion: 'skipped' }]).state, 'failure');
});

await test('CI-GATE-U02: 失敗・取消・API取得失敗・期限超過を成功にしない', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required']) {
    const result = evaluateChecks([successful('Quality gate'), { name: 'E2E', status: 'completed', conclusion }]);
    assert.equal(result.state, 'failure', `accepted ${conclusion}`);
  }
  await assert.rejects(
    () =>
      waitForPullRequest(
        'a'.repeat(40),
        async () => 'a'.repeat(40),
        async () => {
          throw new Error('API unavailable');
        },
      ),
    /API unavailable/,
  );
  assert.throws(() => assertCompleteResponse({ total_count: 101, check_runs: [] }), /不完全/);
  assert.throws(() => assertCompleteStatuses({ total_count: 101, statuses: [] }), /不完全/);
  assert.throws(() => assertCompleteStatuses({}), /statuses を返しません/);
  assert.equal(assertCompleteStatuses({ total_count: 0, statuses: [] }).length, 0);
  const gate = successful('Quality gate');
  assert.equal(
    evaluateChecks([
      gate,
      ...assertCompleteStatuses({ total_count: 1, statuses: [{ context: 'legacy', state: 'success' }] }),
    ]).state,
    'success',
  );
  assert.equal(
    evaluateChecks([
      gate,
      ...assertCompleteStatuses({ total_count: 1, statuses: [{ context: 'legacy', state: 'pending' }] }),
    ]).state,
    'waiting',
  );
  for (const state of ['failure', 'error'])
    assert.equal(
      evaluateChecks([gate, ...assertCompleteStatuses({ total_count: 1, statuses: [{ context: 'legacy', state }] })])
        .state,
      'failure',
    );
  let time = 0;
  await assert.rejects(
    () =>
      waitForPullRequest(
        'a'.repeat(40),
        async () => 'a'.repeat(40),
        async () => [],
        {
          timeoutMs: 100,
          intervalMs: 50,
          now: () => time,
          sleep: async (ms) => {
            time += ms;
          },
        },
      ),
    /タイムアウト/,
  );

  time = 0;
  await assert.rejects(
    () =>
      waitForPullRequest(
        'a'.repeat(40),
        async () => 'a'.repeat(40),
        async () => {
          time = 101;
          return [successful('Quality gate')];
        },
        { timeoutMs: 100, now: () => time },
      ),
    /タイムアウト/,
  );

  time = 0;
  let headCalls = 0;
  await assert.rejects(
    () =>
      waitForPullRequest(
        'a'.repeat(40),
        async () => {
          headCalls++;
          if (headCalls === 3) time = 101;
          return 'a'.repeat(40);
        },
        async () => [successful('Quality gate')],
        { timeoutMs: 100, now: () => time },
      ),
    /タイムアウト/,
  );
});

await test('CI-GATE-U03: 待機中の未知のPR head変更を停止し、成功直前にも照合する', async () => {
  const shaA = 'a'.repeat(40);
  const shaB = 'b'.repeat(40);
  let head = shaA;
  const checked: string[] = [];
  let heads = 0;
  await assert.rejects(
    () =>
      waitForPullRequest(
        shaA,
        async () => {
          heads++;
          if (heads === 3) head = shaB;
          return head;
        },
        async (sha) => {
          checked.push(sha);
          return [successful('Quality gate')];
        },
        { intervalMs: 0, sleep: async () => {} },
      ),
    /head SHA が変わりました/,
  );
  assert.deepEqual(checked, [shaA]);

  const result = await waitForPullRequest(
    shaB,
    async () => shaB,
    async (sha) => {
      checked.push(sha);
      return [successful('Quality gate')];
    },
  );
  assert.equal(result, shaB);
});

await test('CI-GATE-U04: 実行完了を待ち、失敗チェックのログ位置を返す', async () => {
  let calls = 0;
  await waitForPullRequest(
    'a'.repeat(40),
    async () => 'a'.repeat(40),
    async () => {
      calls++;
      return calls === 1
        ? [successful('Quality gate'), { name: 'Unit', status: 'in_progress', conclusion: null }]
        : [successful('Quality gate'), successful('Unit')];
    },
    { intervalMs: 0, sleep: async () => {} },
  );
  assert.equal(calls, 2);
  const failed = evaluateChecks([
    successful('Quality gate'),
    { name: 'E2E', status: 'completed', conclusion: 'failure', html_url: 'https://example.test/run' },
  ]);
  assert.equal(failed.state, 'failure');
  assert.match(failed.details.join('\n'), /https:\/\/example\.test\/run/);
});
