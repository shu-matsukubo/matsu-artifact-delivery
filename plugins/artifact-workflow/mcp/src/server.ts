import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { cleanupResultSchema, planSchema, sessionIdSchema, sessionSchema } from './schema.js';
import { StoreError, type StoreErrorCode } from './errors.js';
import type { PlanRepository } from './repository.js';

// 保存層は失敗理由だけを返し、利用者への操作案内はMCPの境界で補う。
const errorGuidance: Record<StoreErrorCode, string> = {
  INVALID_DIRECTORY: 'Set ARTIFACT_WORKFLOW_DATA_DIR or PLUGIN_DATA to an absolute path.',
  INVALID_DATA: 'Do not infer or overwrite the plan; inspect the stored data before explicitly resetting.',
  NOT_INITIALIZED:
    'Call reset_session only at the start of a new generation flow. Plan later corrections as a new task.',
  REVISION_CONFLICT:
    'Read get_plan and reconcile with the approved plan; verify it before retrying. Never reset to bypass a conflict.',
  SESSION_COMPLETED: 'Plan later corrections as a new task and start a new generation flow with reset_session.',
  PLAN_NOT_SAVED: 'Save an agreed plan with save_plan before completing a flow.',
  SESSION_BUSY:
    'Retry after the writer finishes. If a process crashed, confirm no writer remains before removing only the reported lock file.',
  PLAN_TOO_LARGE:
    'Store references instead of artifact contents to keep the session, including completion metadata, under 1 MiB.',
};

async function respond<T extends Record<string, unknown>>(action: () => Promise<T>) {
  try {
    const result = await action();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    const code = error instanceof StoreError ? error.code : 'STORE_ERROR';
    const message =
      error instanceof StoreError
        ? `${error.message} ${errorGuidance[error.code]}`
        : error instanceof Error
          ? error.message
          : 'Unable to access the plan store.';
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }] };
  }
}

/** 保存実装を受け取り、MCPの入力・出力とエラー応答の契約を提供する。 */
export function createServer(store: PlanRepository): McpServer {
  const server = new McpServer({ name: 'artifact-task-memory', version: '1.0.0' });
  server.registerTool(
    'reset_session',
    {
      description:
        'Begin a NEW generation flow: reset this session and delete all explicitly completed sessions in the same store. Active sessions are preserved. Returns session and cleanup { deleted, skipped: [{ file, code }] }; skipped files remain for a later start. Parent only; never call on reconnect, compaction, continued work, or worker startup. Later corrections require a new task even if the old plan still exists.',
      inputSchema: z.strictObject({ sessionId: sessionIdSchema }),
      outputSchema: z.strictObject({ session: sessionSchema, cleanup: cleanupResultSchema }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ sessionId }) => respond(() => store.reset(sessionId)),
  );
  server.registerTool(
    'save_plan',
    {
      description:
        'Save or replace the COMPLETE agreed plan, including requirements, tasks, and approval evidence. Never store drafts or conversation history. Use the revision from get_plan or reset_session. Parent only; reconcile conflicts, never reset to bypass one.',
      inputSchema: z.strictObject({ sessionId: sessionIdSchema, expectedRevision: z.uuid(), plan: planSchema }),
      outputSchema: z.strictObject({ session: sessionSchema }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ sessionId, expectedRevision, plan }) =>
      respond(async () => ({ session: await store.save(sessionId, expectedRevision, plan) })),
  );
  server.registerTool(
    'complete_session',
    {
      description:
        'Record that the parent has finished ALL tasks, whole-flow verification, and presentation/handoff. The server records this judgment; it does not verify artifacts. Use the latest revision. Do not complete during verification or while handoff still depends on this stored plan. The completed plan becomes read-only and is deleted at a later reset_session in this store. Parent only; later corrections start as a new task.',
      inputSchema: z.strictObject({ sessionId: sessionIdSchema, expectedRevision: z.uuid() }),
      outputSchema: z.strictObject({ session: sessionSchema }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ sessionId, expectedRevision }) =>
      respond(async () => ({ session: await store.complete(sessionId, expectedRevision) })),
  );
  server.registerTool(
    'get_plan',
    {
      description:
        'Read the latest agreed plan, revision, and completedAt for the parent workflow session ID. Read before delegation, continued work, verification, or a plan update. A null session is uninitialized or already collected; a null plan means no agreed plan has been saved. Completed or collected flows are not resumed; plan later corrections as a new task.',
      inputSchema: z.strictObject({ sessionId: sessionIdSchema }),
      outputSchema: z.strictObject({ session: sessionSchema.nullable() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ sessionId }) => respond(async () => ({ session: await store.get(sessionId) })),
  );
  return server;
}
