import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { parse as parseToml } from 'smol-toml';
import { inside, json, loadPlugin, localLinks, read, repository } from '../lib/plugin.ts';

import type { Marketplace, PackageMetadata } from '../../scripts/manifest-types.ts';
import type { FileContract } from '../lib/types.ts';

await test('PKG-U01: marketplace discovers every package with matching metadata and local paths', async () => {
  const catalog = await json<Marketplace>(join(repository, '.agents/plugins/marketplace.json'));
  assert.match(catalog.name, /^[A-Za-z0-9_-]+$/);
  assert.ok(catalog.interface.displayName);
  const names = catalog.plugins.map((entry) => entry.name).sort();
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, (await readdir(join(repository, 'plugins'))).sort());
  for (const entry of catalog.plugins) {
    assert.equal(entry.source.source, 'local');
    assert.equal(entry.source.path, `./plugins/${entry.name}`);
    assert.ok(['NOT_AVAILABLE', 'AVAILABLE', 'INSTALLED_BY_DEFAULT'].includes(entry.policy.installation));
    assert.ok(['ON_INSTALL', 'ON_USE'].includes(entry.policy.authentication));
    assert.ok(entry.category);
    const plugin = await loadPlugin(inside(repository, entry.source.path));
    assert.equal(plugin.manifest.name, entry.name);
    assert.equal(await read(join(plugin.root, 'LICENSE')), await read(join(repository, 'LICENSE')));
  }
});

await test('PKG-U02: the read-only Workflow reviewer and Escalation roles match their registrations', async () => {
  const config = parseToml(await read(join(repository, '.codex/config.toml'))) as {
    agents: Record<string, { config_file: string }>;
  };
  const catalog = await json<Marketplace>(join(repository, '.agents/plugins/marketplace.json'));
  const shipped = [];
  for (const entry of catalog.plugins) {
    const plugin = await loadPlugin(inside(repository, entry.source.path));
    if (entry.name === 'artifact-workflow') {
      assert.deepEqual([...plugin.agents.keys()], ['artifact-reviewer']);
    }
    for (const [name, agent] of plugin.agents) {
      shipped.push(name);
      const path = inside(repository, join('.codex', config.agents[name]!.config_file));
      assert.deepEqual(parseToml(await read(path)), agent);
    }
  }
  assert.deepEqual(Object.keys(config.agents).sort(), shipped.sort());
});

await test('PKG-U03: Plugin installation documents reviewer registration and resolves local links', async () => {
  for (const path of [
    'README.md',
    'docs/testing.md',
    'docs/distribution.md',
    'plugins/artifact-workflow/README.md',
    'plugins/expert-escalation/README.md',
  ])
    await localLinks(repository, path);

  const workflowReadme = await read(join(repository, 'plugins/artifact-workflow/README.md'));
  assert.ok(workflowReadme.includes('[agents.artifact-reviewer]'));
  assert.ok(workflowReadme.includes('artifact-workflow/<installed-version>/com.openai/agents/artifact-reviewer.toml'));
  assert.ok(workflowReadme.includes('codex plugin marketplace upgrade matsu-artifact-delivery'));
  assert.ok(workflowReadme.includes('Codex を再起動'));
});

await test('PKG-U04: all contract IDs and runnable suites appear in the test inventory', async () => {
  // Guide-only changes select infrastructure, not the Workflow / Escalation units.
  const docs = await read(join(repository, 'docs/testing.md'));
  for (const suite of ['workflow', 'escalation']) {
    for (const contract of await json<FileContract[]>(join(repository, `test/${suite}/contracts.json`)))
      assert.ok(docs.includes(contract.id), `Undocumented ${contract.id}`);
  }
  const { scripts } = await json<PackageMetadata>(join(repository, 'package.json'));
  for (const command of ['test:workflow', 'test:escalation', 'test:integration', 'test:infrastructure', 'test:mcp']) {
    assert.ok(scripts[command], `Missing command: ${command}`);
    assert.ok(docs.includes(command), `Undocumented ${command}`);
  }
});
