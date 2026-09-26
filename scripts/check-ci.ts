import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { layers, suites, targetsFor } from './test-targets.ts';

export interface JobResult {
  result?: string;
  outputs?: Record<string, string | undefined>;
}
export type JobNeeds = Partial<Record<'changes' | 'unit' | 'e2e', JobResult>>;

export function checkResults(needs: JobNeeds | null) {
  const errors = [];
  if (needs?.changes?.result !== 'success') errors.push('Change detection did not succeed');
  const outputs = needs?.changes?.outputs ?? {};
  for (const layer of layers) {
    let selected;
    try {
      selected = JSON.parse(outputs[`${layer}_targets`] ?? '');
      if (targetsFor(layer, selected).length !== selected.length) throw new Error('Wrong test layer');
    } catch {
      errors.push(`Missing or invalid ${layer} target selection`);
      selected = targetsFor(layer, suites);
    }
    const required = selected.length > 0;
    const accepted = required ? ['success'] : ['success', 'skipped'];
    if (!accepted.includes(needs?.[layer]?.result ?? ''))
      errors.push(`${layer}: ${needs?.[layer]?.result ?? 'missing'}${required ? ' (required)' : ''}`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const errors = checkResults(JSON.parse(process.env.CI_NEEDS ?? ''));
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('All selected checks passed.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
