import assert from 'node:assert/strict';
import test from 'node:test';
import { planSchema } from '../mcp/src/schema.js';
import { plan } from './fixtures.js';

await test('only complete agreed plans are accepted without accessing storage', () => {
  assert.deepEqual(planSchema.parse(plan), plan);
  for (const invalid of [
    { ...plan, approval: { mode: 'pending', evidence: '未承認' } },
    { ...plan, approval: { mode: 'approved', evidence: '  ' } },
    { ...plan, conversation: '未確定な会話' },
    { ...plan, tasks: [plan.tasks[0], plan.tasks[0]] },
    { ...plan, tasks: [{ ...plan.tasks[0], dependsOn: ['missing'] }] },
    { ...plan, tasks: [{ ...plan.tasks[0], dependsOn: ['T1'] }] },
    { ...plan, tasks: [] },
  ]) {
    assert.equal(planSchema.safeParse(invalid).success, false);
  }
  assert.equal(
    planSchema.safeParse({
      ...plan,
      approval: { mode: 'waived', evidence: 'ユーザーが今回の承認省略を明示した' },
    }).success,
    true,
  );
});

await test('dependency findings become distinct Zod messages at the offending input paths', () => {
  const task = plan.tasks[0]!;
  const cases = [
    { tasks: [task, task], path: ['tasks', 1, 'id'], message: 'Duplicate task ID.' },
    {
      tasks: [{ ...task, dependsOn: ['missing'] }],
      path: ['tasks', 0, 'dependsOn', 0],
      message: 'Dependency must name an existing task.',
    },
    {
      tasks: [{ ...task, dependsOn: ['T1'] }],
      path: ['tasks', 0, 'dependsOn', 0],
      message: 'Dependencies must have no cycles.',
    },
  ];
  for (const item of cases) {
    const parsed = planSchema.safeParse({ ...plan, tasks: item.tasks });
    assert.equal(parsed.success, false);
    assert.deepEqual(
      parsed.error?.issues.map(({ code, path, message }) => ({ code, path, message })),
      [{ code: 'custom', path: item.path, message: item.message }],
    );
  }
});
