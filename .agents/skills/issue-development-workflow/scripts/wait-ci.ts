import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
}

export type CheckState = 'waiting' | 'success' | 'failure';

export interface CheckResponse {
  check_runs?: CheckRun[];
  total_count?: number;
}

export interface StatusResponse {
  statuses?: Array<{ context: string; state: string; target_url?: string }>;
  total_count?: number;
}

export function evaluateChecks(runs: CheckRun[]): { state: CheckState; details: string[] } {
  if (runs.length === 0) return { state: 'waiting', details: ['チェックがまだありません'] };
  const gate = runs.find((run) => run.name === 'Quality gate');
  if (!gate) return { state: 'waiting', details: ['Quality gate がまだありません'] };
  if (gate.status === 'completed' && gate.conclusion !== 'success')
    return { state: 'failure', details: [`Quality gate: ${gate.conclusion ?? '結論なし'} ${gate.html_url ?? ''}`] };
  const failed = runs.filter((run) => {
    if (run.status !== 'completed' || run.conclusion === 'success') return false;
    return !(run.conclusion === 'skipped' && /^(Unit|E2E) \/ /.test(run.name));
  });
  if (failed.length)
    return {
      state: 'failure',
      details: failed.map((run) => `${run.name}: ${run.conclusion ?? '結論なし'} ${run.html_url ?? ''}`),
    };
  const pending = runs.filter((run) => run.status !== 'completed');
  if (pending.length || gate.status !== 'completed')
    return { state: 'waiting', details: pending.map((run) => `${run.name}: ${run.status}`) };
  if (gate.conclusion !== 'success') return { state: 'failure', details: ['Quality gate が success ではありません'] };
  return { state: 'success', details: [] };
}

export function assertCompleteResponse(response: CheckResponse): CheckRun[] {
  if (!Array.isArray(response.check_runs)) throw new Error('GitHub API が check_runs を返しませんでした');
  if (response.total_count !== response.check_runs.length)
    throw new Error(`チェック取得が不完全です (${response.check_runs.length}/${response.total_count ?? '不明'})`);
  return response.check_runs;
}

export function assertCompleteStatuses(response: StatusResponse): CheckRun[] {
  if (!Array.isArray(response.statuses)) throw new Error('GitHub API が statuses を返しませんでした');
  if (response.total_count !== response.statuses.length)
    throw new Error(`Commit Status 取得が不完全です (${response.statuses.length}/${response.total_count ?? '不明'})`);
  return response.statuses.map((status) => ({
    name: `Commit Status: ${status.context}`,
    status: status.state === 'pending' ? 'in_progress' : 'completed',
    conclusion: status.state === 'success' ? 'success' : status.state,
    ...(status.target_url ? { html_url: status.target_url } : {}),
  }));
}

export async function waitForPullRequest(
  expectedSha: string,
  fetchHead: () => Promise<string>,
  fetchRuns: (sha: string) => Promise<CheckRun[]>,
  options: { timeoutMs?: number; intervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const intervalMs = options.intervalMs ?? 20_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  const sha = await fetchHead();
  if (now() >= deadline)
    throw new Error(`CI 完了待ちが ${timeoutMs / 60_000} 分でタイムアウトしました。確認中 SHA: ${sha}`);
  if (sha !== expectedSha)
    throw new Error(
      `PR head SHA が検証済み SHA と異なります (${sha} != ${expectedSha})。新しい SHA を検証して再実行してください。`,
    );
  let lastState = 'チェック未取得';
  while (now() < deadline) {
    const latest = await fetchHead();
    if (now() >= deadline)
      throw new Error(
        `CI 完了待ちが ${timeoutMs / 60_000} 分でタイムアウトしました。確認中 SHA: ${latest}。最終状態: ${lastState}`,
      );
    if (latest !== sha)
      throw new Error(`待機中に PR head SHA が変わりました (${latest})。新しい SHA を検証して再実行してください。`);
    const result = evaluateChecks(await fetchRuns(sha));
    lastState = result.state === 'waiting' ? result.details.join(', ') || '実行中' : result.state;
    if (now() >= deadline)
      throw new Error(
        `CI 完了待ちが ${timeoutMs / 60_000} 分でタイムアウトしました。確認中 SHA: ${sha}。最終状態: ${lastState}`,
      );
    if (result.state === 'failure') throw new Error(`CI が成功しませんでした:\n${result.details.join('\n')}`);
    if (result.state === 'success') {
      const finalHead = await fetchHead();
      if (now() >= deadline)
        throw new Error(
          `CI 完了待ちが ${timeoutMs / 60_000} 分でタイムアウトしました。確認中 SHA: ${sha}。最終状態: ${lastState}`,
        );
      if (finalHead === sha) return sha;
      throw new Error(
        `成功確認前に PR head SHA が変わりました (${finalHead})。新しい SHA を検証して再実行してください。`,
      );
    }
    await sleep(Math.min(intervalMs, deadline - now()));
  }
  throw new Error(
    `CI 完了待ちが ${timeoutMs / 60_000} 分でタイムアウトしました。確認中 SHA: ${sha}。最終状態: ${lastState}`,
  );
}

function api(repository: string, path: string): string {
  const response = execFileSync('gh', ['api', `repos/${repository}/${path}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  });
  return response;
}

async function main(): Promise<void> {
  const [repository, pullRequest, expectedSha] = process.argv.slice(2);
  if (
    !/^[^/\s]+\/[^/\s]+$/.test(repository ?? '') ||
    !/^\d+$/.test(pullRequest ?? '') ||
    !/^[0-9a-f]{40}$/i.test(expectedSha ?? '')
  )
    throw new Error('使い方: node wait-ci.ts <owner/repository> <PR番号> <検証済みHEAD SHA>');
  const repo = repository!;
  const pr = pullRequest!;
  const fetchHead = async () => {
    const parsed = JSON.parse(api(repo, `pulls/${pr}`)) as { state?: string; head?: { sha?: string } };
    if (parsed.state !== 'open') throw new Error(`PR が Open ではありません (${parsed.state ?? '状態不明'})`);
    if (!/^[0-9a-f]{40}$/i.test(parsed.head?.sha ?? '')) throw new Error('PR の head SHA を取得できませんでした');
    return parsed.head!.sha!;
  };
  const sha = await waitForPullRequest(expectedSha!, fetchHead, (head) => {
    const response = JSON.parse(api(repo, `commits/${head}/check-runs?filter=latest&per_page=100`)) as CheckResponse;
    const runs = assertCompleteResponse(response);
    const statuses = JSON.parse(api(repo, `commits/${head}/status?per_page=100`)) as StatusResponse;
    return Promise.resolve([...runs, ...assertCompleteStatuses(statuses)]);
  });
  console.log(`HEAD ${sha} の GitHub Actions と Quality gate はすべて成功しました。`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
