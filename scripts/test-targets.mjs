export const suites = ['mcp', 'workflow', 'escalation', 'integration', 'infrastructure'];
export const layers = ['unit', 'e2e'];

// The unit job includes component integration and build checks. E2E starts the
// shipped MCP process, or traverses the packaged Skill/Plugin contracts.
export const tests = {
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
    workflow: ['test/workflow/unit.test.mjs'],
    escalation: ['test/escalation/unit.test.mjs'],
    infrastructure: ['test/infrastructure/*.test.mjs'],
  },
  e2e: {
    mcp: ['mcp.test.ts'],
    workflow: ['test/workflow/e2e.test.mjs'],
    escalation: ['test/escalation/e2e.test.mjs'],
    integration: ['test/integration/*.test.mjs'],
  },
};

export function validateTargets(targets) {
  if (
    !Array.isArray(targets) ||
    new Set(targets).size !== targets.length ||
    targets.some((target) => !suites.includes(target))
  ) {
    throw new Error(`Targets must be unique names from: ${suites.join(', ')}`);
  }
  return suites.filter((target) => targets.includes(target));
}

export function targetsFor(layer, targets) {
  if (!layers.includes(layer)) throw new Error(`Unknown test layer: ${layer}`);
  return validateTargets(targets).filter((target) => Object.hasOwn(tests[layer], target));
}

export function environmentMatrix(targets) {
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
