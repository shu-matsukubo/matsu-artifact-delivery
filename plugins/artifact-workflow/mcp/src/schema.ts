import * as z from 'zod/v4';

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
    const ids = new Set<string>();
    for (const [index, task] of plan.tasks.entries()) {
      if (ids.has(task.id)) {
        ctx.addIssue({ code: 'custom', path: ['tasks', index, 'id'], message: 'Duplicate task ID.' });
      }
      ids.add(task.id);
    }
    const tasks = new Map(plan.tasks.map((task) => [task.id, task]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return false;
      if (visited.has(id)) return true;
      visiting.add(id);
      for (const dependency of tasks.get(id)?.dependsOn ?? []) {
        if (!tasks.has(dependency) || !visit(dependency)) return false;
      }
      visiting.delete(id);
      visited.add(id);
      return true;
    };
    if (plan.tasks.some((task) => !visit(task.id))) {
      ctx.addIssue({
        code: 'custom',
        path: ['tasks'],
        message: 'Dependencies must name existing tasks and have no cycles.',
      });
    }
  });

export const sessionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sessionId: sessionIdSchema,
    revision: z.uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    // Snapshots written before completion tracking remain active until explicitly completed.
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
