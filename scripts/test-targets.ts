import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const suites = ['mcp', 'workflow', 'escalation', 'integration', 'infrastructure'] as const;
export type Suite = (typeof suites)[number];
export const layers = ['unit', 'e2e'] as const;
export type Layer = (typeof layers)[number];
export type TestRegistry = Record<Layer, { mcp: string[] } & Partial<Record<Suite, string[]>>>;

// The unit job includes component integration and build checks. E2E starts the
// shipped MCP process, or traverses the packaged Skill/Plugin contracts.
export const tests: TestRegistry = {
  unit: {
    mcp: [
      'build',
      'cleanup',
      'config',
      'schema',
      'server',
      'session',
      'snapshot-files',
      'snapshot',
      'store',
      'task-dependencies',
    ].map((name) => `${name}.test.ts`),
    workflow: ['test/workflow/unit.test.ts'],
    escalation: ['test/escalation/unit.test.ts'],
    infrastructure: ['test/infrastructure/*.test.ts'],
  },
  e2e: {
    mcp: ['mcp.test.ts'],
    workflow: ['test/workflow/e2e.test.ts'],
    escalation: ['test/escalation/e2e.test.ts'],
    integration: ['test/integration/*.test.ts'],
  },
};

export function validateTargets(targets: unknown): Suite[] {
  if (
    !Array.isArray(targets) ||
    new Set(targets).size !== targets.length ||
    targets.some((target) => !suites.some((suite) => suite === target))
  ) {
    throw new Error(`Targets must be unique names from: ${suites.join(', ')}`);
  }
  return suites.filter((target) => targets.includes(target));
}

export function targetsFor(layer: string, targets: unknown): Suite[] {
  if (layer !== 'unit' && layer !== 'e2e') throw new Error(`Unknown test layer: ${layer}`);
  return validateTargets(targets).filter((target) => Object.hasOwn(tests[layer], target));
}

export function environmentMatrix(targets: readonly string[]) {
  validateTargets(targets);
  const include = [{ os: 'ubuntu-latest', node: '22.19.0', primary: true }];
  if (targets.includes('mcp')) {
    for (const os of ['ubuntu-latest', 'windows-latest', 'macos-latest']) {
      for (const node of ['22.19.0', '24']) {
        if (os !== 'ubuntu-latest' || node !== '22.19.0') include.push({ os, node, primary: false });
      }
    }
  }
  return { include };
}

function mcpTestFiles(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) return mcpTestFiles(join(directory, entry.name), `${relative}/`);
    return entry.name.endsWith('.test.ts') ? [relative] : [];
  });
}

export function assertMcpTestRegistry(directory: string, registry: Record<Layer, { mcp: string[] }> = tests) {
  const discovered = mcpTestFiles(directory);
  const registered = layers.flatMap((layer) => registry[layer].mcp);
  const unregistered = discovered.filter((file) => !registered.includes(file)).sort();
  const missing = registered.filter((file) => !discovered.includes(file)).sort();
  const duplicates = [...new Set(registered.filter((file, index) => registered.indexOf(file) !== index))].sort();
  const problems = [];
  if (unregistered.length) problems.push(`Unregistered MCP tests: ${unregistered.join(', ')}`);
  if (missing.length) problems.push(`Missing MCP test files: ${missing.join(', ')}`);
  if (duplicates.length) problems.push(`Duplicate MCP registrations: ${duplicates.join(', ')}`);
  if (problems.length)
    throw new Error(`${problems.join('\n')}\nRegister each MCP .test.ts exactly once in scripts/test-targets.ts.`);
}
