import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { cleanupResultSchema, planSchema, sessionIdSchema, sessionSchema } from './schema.js';
import { PlanStore, StoreError } from './store.js';

async function respond<T extends Record<string, unknown>>(action: () => Promise<T>) {
  try {
    const result = await action();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    const code = error instanceof StoreError ? error.code : 'STORE_ERROR';
    const message = error instanceof Error ? error.message : 'Unable to access the plan store.';
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }] };
  }
}

export function createServer(store = new PlanStore()): McpServer {
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
