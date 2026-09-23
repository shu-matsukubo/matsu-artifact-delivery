import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { suites } from './select-tests.mjs';

export function checkResults(needs) {
  const errors = [];
  if (needs.changes?.result !== 'success') errors.push('Change detection did not succeed');
  const outputs = needs.changes?.outputs ?? {};
  if (!['true', 'false'].includes(outputs.mcp)) errors.push('Missing MCP selection');
  let selected;
  try {
    selected = JSON.parse(outputs.suites);
    if (
      !Array.isArray(selected) ||
      selected.some((suite) => !suites.includes(suite) || suite === 'mcp') ||
      new Set(selected).size !== selected.length
    )
      throw new Error('Invalid suites');
  } catch {
    errors.push('Missing or invalid suite selection');
    selected = suites.filter((suite) => suite !== 'mcp');
  }
  for (const [job, required] of [
    ['mcp', outputs.mcp !== 'false'],
    ['contracts', selected.length > 0],
  ]) {
    const accepted = required ? ['success'] : ['success', 'skipped'];
    if (!accepted.includes(needs[job]?.result))
      errors.push(`${job}: ${needs[job]?.result ?? 'missing'}${required ? ' (required)' : ''}`);
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const errors = checkResults(JSON.parse(process.env.CI_NEEDS));
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('All selected checks passed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
