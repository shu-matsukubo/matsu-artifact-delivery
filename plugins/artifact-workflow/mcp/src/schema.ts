import * as z from 'zod/v4';
import { validateTaskDependencies } from './task-dependencies.js';

const text = z.string().trim().min(1).max(100_000);
const lines = z.array(text).max(500);
const taskId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);

export const sessionIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/)
  .describe('The parent workflow session ID. Reuse it for reads and writes; never use a worker ID.');

export const planSchema = z
  .strictObject({
    request: text.describe('Original user request, without the conversation history.'),
    scope: text.describe('Agreed purpose and scope of this generation flow.'),
    requirements: lines,
    constraints: lines,
    inputs: z.array(z.strictObject({ description: text, reference: text })).max(200),
    tasks: z
      .array(
        z.strictObject({
          id: taskId,
          description: text,
          purpose: text,
          deliverable: text,
          acceptanceCriteria: lines.min(1),
          dependsOn: z.array(taskId).max(200),
        }),
      )
      .min(1)
      .max(200),
    acceptanceCriteria: lines.min(1).describe('Completion criteria for the whole generation flow.'),
    delivery: text.describe('Agreed handoff information and any subsequent user request.'),
    approval: z.strictObject({
      mode: z.enum(['approved', 'waived']),
      evidence: text.describe('User approval, or the explicit instruction and scope waiving approval.'),
    }),
  })
  .superRefine((plan, ctx) => {
    for (const issue of validateTaskDependencies(plan.tasks)) {
      if (issue.kind === 'duplicate_id') {
        ctx.addIssue({ code: 'custom', path: ['tasks', issue.taskIndex, 'id'], message: 'Duplicate task ID.' });
      } else {
        ctx.addIssue({
          code: 'custom',
          path: ['tasks', issue.taskIndex, 'dependsOn', issue.dependencyIndex],
          message:
            issue.kind === 'missing_dependency'
              ? 'Dependency must name an existing task.'
              : 'Dependencies must have no cycles.',
        });
      }
    }
  });

export const sessionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sessionId: sessionIdSchema,
    revision: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    // 完了記録の導入前に保存されたデータは、明示的に完了されるまで未完了として保持する。
    completedAt: z.iso.datetime().nullable().default(null),
    plan: planSchema.nullable(),
  })
  .refine((session) => session.completedAt === null || session.plan !== null, {
    message: 'A completed session must contain an agreed plan.',
  });

export const cleanupResultSchema = z.strictObject({
  deleted: z.number().int().nonnegative(),
  skipped: z.array(z.strictObject({ file: z.string().min(1), code: z.string().min(1) })),
});

export type CleanupResult = z.infer<typeof cleanupResultSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Session = z.infer<typeof sessionSchema>;
