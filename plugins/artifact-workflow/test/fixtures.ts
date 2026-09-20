import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import type { Plan, Session } from '../mcp/src/schema.js';

export const plan: Plan = {
  request: '月次レポートを作成してください。',
  scope: '提供データからレポート本文を作る。',
  requirements: ['日本語で作成する'],
  constraints: ['公開はこの生成フローの対象外'],
  inputs: [{ description: '入力データ', reference: 'C:/inputs/month.csv' }],
  tasks: [
    {
      id: 'T1',
      description: 'レポート作成',
      purpose: '月次の状況を伝える',
      deliverable: 'C:/outputs/report.md',
      acceptanceCriteria: ['提供データと整合する'],
      dependsOn: [],
    },
  ],
  acceptanceCriteria: ['完成したレポートを参照できる'],
  delivery: '完成品の絶対パスと検証結果を親へ返す。',
  approval: { mode: 'approved', evidence: 'ユーザーが上記計画に「承認します」と回答。' },
};

/** Fill a valid plan to an exact serialized UTF-8 snapshot size. */
export function planAtSnapshotSize(session: Session, bytes: number): Plan {
  const sized = { ...plan, requirements: [...Array<string>(10).fill('あ'.repeat(33_000)), 'x'] };
  const size = Buffer.byteLength(`${JSON.stringify({ ...session, plan: sized }, null, 2)}\n`);
  const padding = bytes - size;
  if (padding < 0 || padding >= 100_000) throw new Error('Requested size is outside the fixture range.');
  sized.requirements[sized.requirements.length - 1] = 'x'.repeat(padding + 1);
  return sized;
}

export async function temporaryDirectory(t: TestContext, cleanup: Array<() => Promise<void>> = []): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'artifact-task-memory-test-'));
  t.after(async () => {
    for (const close of cleanup) await close();
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('artifact-task-memory-test-')) {
      throw new Error('Refusing to remove a path outside this test fixture.');
    }
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });
  return directory;
}
