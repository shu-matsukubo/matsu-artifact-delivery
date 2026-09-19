import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { planSchema, sessionIdSchema } from './schema.js';
import { PlanStore, StoreError } from './store.js';

async function respond(action: () => Promise<unknown>) {
  try {
    const session = await action();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ session }) }],
      structuredContent: { session },
    };
  } catch (error) {
    const code = error instanceof StoreError ? error.code : 'STORE_ERROR';
    const message = error instanceof Error ? error.message : 'Unable to access the plan store.';
    return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: code, message }) }] };
  }
}

export function createServer(store = new PlanStore()): McpServer {
  const server = new McpServer({ name: 'artifact-task-memory', version: '1.0.0' });
  server.registerTool('reset_session', {
    description: 'Begin a NEW generation flow: discard ALL previously held plan data for this session ID and create an empty snapshot. Other session IDs are untouched. Parent only; never call on reconnect, compaction, continued work, or worker startup.',
    inputSchema: z.strictObject({ sessionId: sessionIdSchema }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, ({ sessionId }) => respond(() => store.reset(sessionId)));
  server.registerTool('save_plan', {
    description: 'Save or replace the COMPLETE agreed plan, including requirements, tasks, and approval evidence. Never store drafts or conversation history. Use the revision from get_plan or reset_session. Parent only; reconcile conflicts, never reset to bypass one.',
    inputSchema: z.strictObject({ sessionId: sessionIdSchema, expectedRevision: z.uuid(), plan: planSchema }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, ({ sessionId, expectedRevision, plan }) => respond(() => store.save(sessionId, expectedRevision, plan)));
  server.registerTool('get_plan', {
    description: 'Read the latest agreed plan and revision for the parent workflow session ID. Read before delegation, continued work, verification, or a plan update. A null session is uninitialized; a null plan means no agreed plan has been saved.',
    inputSchema: z.strictObject({ sessionId: sessionIdSchema }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ({ sessionId }) => respond(() => store.get(sessionId)));
  return server;
}
