import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { environmentMatrix, suites, targetsFor } from './test-targets.mjs';

export { suites } from './test-targets.mjs';

const workflow = ['workflow', 'integration'];
const escalation = ['escalation', 'integration'];
const workflowPackage = ['mcp', ...workflow];

// Unknown paths deliberately run everything. Keep narrower rules ahead of broad ones.
export function selectTests(files) {
  if (!Array.isArray(files) || files.length === 0) return allTests('No reliable changed-file list');
  const selected = new Set();
  for (const file of files) {
    if (
      typeof file !== 'string' ||
      !file ||
      file.includes('\\') ||
      file.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      return allTests('Unrecognized path');
    }
    let affected;
    if (/^plugins\/artifact-workflow\/(skills\/|com\.openai\/agents\/)/.test(file)) affected = workflow;
    else if (/^plugins\/artifact-workflow\/(mcp|test)\//.test(file)) affected = ['mcp'];
    else if (/^plugins\/artifact-workflow\/scripts\//.test(file)) affected = workflowPackage;
    else if (
      /^plugins\/artifact-workflow\/(plugin\.json|\.codex-plugin\/plugin\.json|\.?mcp\.json|package(-lock)?\.json)$/.test(
        file,
      )
    )
      affected = workflowPackage;
    else if (/^plugins\/artifact-workflow\/(tsconfig\.json|\.oxlintrc\.json|\.prettierrc\.json)$/.test(file))
      affected = ['mcp'];
    else if (/^plugins\/artifact-workflow\/(README\.md|LICENSE)$/.test(file)) affected = workflow;
    else if (
      /^plugins\/expert-escalation\/(skills\/|com\.openai\/agents\/|plugin\.json$|\.codex-plugin\/plugin\.json$|README\.md$|LICENSE$)/.test(
        file,
      )
    )
      affected = escalation;
    else if (/^test\/workflow\//.test(file)) affected = workflow;
    else if (/^test\/escalation\//.test(file)) affected = escalation;
    else if (/^test\/integration\//.test(file)) affected = ['integration'];
    else if (file === 'README.md' || file === 'docs/testing.md') affected = ['infrastructure'];
    else return allTests(`Shared or unclassified path: ${file}`);
    affected.forEach((suite) => selected.add(suite));
  }
  return { selected: suites.filter((suite) => selected.has(suite)), reason: 'Changed-file dependencies' };
}

export function allTests(reason) {
  return { selected: [...suites], reason };
}

export function selectEvent(eventName, event, cwd = process.cwd()) {
  if (eventName === 'workflow_dispatch') return allTests('Manual full run');
  const refs =
    eventName === 'pull_request'
      ? [event?.pull_request?.base?.sha, event?.pull_request?.head?.sha]
      : eventName === 'push'
        ? [event?.before, event?.after]
        : [];
  if (
    refs.length !== 2 ||
    refs.some((ref) => typeof ref !== 'string' || !/^[a-f0-9]{40,64}$/i.test(ref) || /^0+$/.test(ref))
  ) {
    return allTests('Missing or unsupported event refs');
  }
  try {
    // A PR is its branch diff, not base..merge-commit. Disable rename detection so
    // BOTH the old and new paths participate; -z preserves whitespace and Unicode.
    const range = refs.join(eventName === 'pull_request' ? '...' : '..');
    const changed = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', range, '--'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return selectTests(changed.split('\0').filter(Boolean));
  } catch {
    return allTests('Git diff unavailable; run all suites');
  }
}

export function formatOutputs(selection) {
  const outputs = {
    unit_targets: JSON.stringify(targetsFor('unit', selection.selected)),
    e2e_targets: JSON.stringify(targetsFor('e2e', selection.selected)),
    matrix: JSON.stringify(environmentMatrix(selection.selected)),
  };
  return Object.entries(outputs)
    .map(([name, value]) => `${name}=${value}\n`)
    .join('');
}

export function main(args = process.argv.slice(2), env = process.env) {
  let selection;
  try {
    if (args.length === 1 && args[0] === '--all') selection = allTests('Explicit full run');
    else if (args[0] === '--files') selection = selectTests(args.slice(1));
    else if (args.length) selection = allTests('Unknown selector arguments');
    else selection = selectEvent(env.GITHUB_EVENT_NAME, JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')));
  } catch {
    selection = allTests('Event data unavailable; run all suites');
  }
  const output = formatOutputs(selection);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, output);
  console.log(JSON.stringify(selection, null, 2));
  return selection;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
