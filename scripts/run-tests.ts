import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertMcpTestRegistry, layers, suites, targetsFor, tests, validateTargets } from './test-targets.ts';

export interface TestCommand {
  label: string;
  cwd: string;
  args: string[];
}
export interface TestPlan {
  batches: { layer: 'unit' | 'e2e'; targets: string[] }[];
  commands: TestCommand[];
}
export type Execute = (
  command: string,
  args: string[],
  options: SpawnSyncOptions,
) => { status?: number | null; error?: Error; signal?: NodeJS.Signals | null };

const root = fileURLToPath(new URL('../', import.meta.url));
const mcpRoot = resolve(root, 'plugins/artifact-workflow');

export function parseArguments(args: string[]) {
  const [layer, ...options] = args;
  if (layer !== 'unit' && layer !== 'e2e' && layer !== 'all')
    throw new Error('Usage: run-tests.ts unit|e2e|all [--targets a,b | --targets-json JSON] [--dry-run]');
  let targets: unknown = suites;
  let specified = false;
  let dryRun = false;
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    if (option === '--dry-run' && !dryRun) dryRun = true;
    else if ((option === '--targets' || option === '--targets-json') && !specified) {
      const value = options[++index];
      if (!value) throw new Error(`Missing value for ${option}`);
      targets = option === '--targets-json' ? JSON.parse(value) : value.split(',');
      specified = true;
    } else throw new Error(`Unknown or repeated argument: ${option}`);
  }
  const selected = validateTargets(targets);
  if (!selected.length) throw new Error('No targets selected');
  return { layer, targets: selected, dryRun };
}

export function createPlan(layer: string, targets: readonly string[]): TestPlan {
  if (layer !== 'unit' && layer !== 'e2e' && layer !== 'all') throw new Error(`Unknown test layer: ${layer}`);
  validateTargets(targets);
  const selectedLayers: readonly ('unit' | 'e2e')[] = layer === 'all' ? layers : [layer];
  const batches = selectedLayers
    .map((name) => ({ layer: name, targets: targetsFor(name, targets) }))
    .filter((batch) => batch.targets.length);
  if (!batches.length) throw new Error(`No ${layer} tests for selected targets`);
  const commands: TestCommand[] = [];
  if (targets.includes('mcp')) {
    // This preflight also runs for MCP-only CI, where infrastructure tests are not selected.
    assertMcpTestRegistry(resolve(mcpRoot, 'test'));
    // Verify the committed distribution before running it; never rebuild it here.
    commands.push(
      { label: 'MCP distribution', cwd: mcpRoot, args: ['scripts/build.ts', '--check'] },
      { label: 'MCP clean test output', cwd: mcpRoot, args: ['scripts/clean-test.ts'] },
      { label: 'MCP compile tests', cwd: mcpRoot, args: ['node_modules/typescript/bin/tsc'] },
    );
  }
  for (const batch of batches) {
    const rootTargets = batch.targets.filter((target) => target !== 'mcp');
    if (rootTargets.length)
      commands.push({
        label: `${batch.layer}: ${rootTargets.join(', ')}`,
        cwd: root,
        args: ['--test', ...rootTargets.flatMap((target) => tests[batch.layer][target] ?? [])],
      });
    if (batch.targets.includes('mcp'))
      commands.push({
        label: `${batch.layer}: mcp`,
        cwd: mcpRoot,
        args: ['--test', ...tests[batch.layer].mcp.map((name) => `.test-build/test/${name.replace(/\.ts$/, '.js')}`)],
      });
  }
  return { batches, commands };
}

export function executePlan(plan: TestPlan, execute: Execute = spawnSync) {
  for (const command of plan.commands) {
    console.log(`\n[${command.label}]`);
    const result = execute(process.execPath, command.args, { cwd: command.cwd, stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const plan = createPlan(options.layer, options.targets);
    if (options.dryRun) console.log(JSON.stringify(plan, null, 2));
    else process.exitCode = executePlan(plan);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
