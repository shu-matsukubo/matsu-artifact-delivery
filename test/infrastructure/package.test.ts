import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { parse as parseToml } from 'smol-toml';
import {
  files,
  frontmatter,
  inside,
  json,
  loadPlugin,
  localLinks,
  read,
  repository,
  stagePlugin,
} from '../lib/plugin.ts';

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

await test('PKG-U02: project Codex settings stay outside packages; prompt roles need no Custom Agent registration', async (t) => {
  const catalog = await json<Marketplace>(join(repository, '.agents/plugins/marketplace.json'));
  await access(join(repository, '.codex/config.toml'));
  for (const entry of catalog.plugins) {
    const plugin = await stagePlugin(t, entry.name);
    assert.deepEqual([...plugin.agents.keys()], []);
    const packagedFiles = await files(plugin.root);
    assert.ok(
      !packagedFiles.some((path) => path.startsWith('.codex/')),
      `Repository Codex settings must not be packaged: ${entry.name}`,
    );
  }
});

await test('PKG-U03: Plugin documentation resolves local links and explains reviewer permissions', async () => {
  for (const path of [
    'README.md',
    'docs/testing.md',
    'docs/distribution.md',
    'plugins/artifact-workflow/README.md',
    'plugins/expert-escalation/README.md',
  ])
    await localLinks(repository, path);

  const workflowReadme = await read(join(repository, 'plugins/artifact-workflow/README.md'));
  assert.ok(workflowReadme.includes('これは実行環境の権限を変更しません'));
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

await test('SCH-U01: scheduled Issue processing is explicit and preserves remote-state and role boundaries', async () => {
  const { metadata, body } = frontmatter(
    await read(join(repository, '.agents/skills/scheduled-issue-processing/SKILL.md')),
  );
  assert.equal(metadata.name, 'scheduled-issue-processing');
  assert.match(metadata.description, /スケジューラが.*明示指定した場合のみ/);
  assert.match(metadata.description, /通常の Issue 対応や一般的な開発作業には使用しない/);
  assert.match(body, /GitHub Plugin.*read\/write capability/s);
  assert.match(body, /git、`gh`、ブラウザー等へフォールバックせず停止/);
  assert.match(body, /default branch とその最新コミット SHA/);
  assert.match(body, /同名ブランチが既にある場合は再利用・上書きせず停止/);
  assert.match(body, /`git push` は使用しない/);
  assert.match(body, /レビュー済みの変更が反映済みであることを確認してから、Issue を参照する Open PR を作成/);
  assert.match(body, /`Closes`、`Fixes`、`Resolves` 等の Issue closing keyword を含めない/);
  assert.match(body, /Issue はこの Skill では閉じず/);
  assert.match(body, /plugin-maintenance/);
  assert.match(body, /plugin-review/);

  const codex = parseToml(await read(join(repository, '.codex/config.toml'))) as {
    model: string;
    model_reasoning_effort: string;
  };
  const implementer = parseToml(await read(join(repository, '.codex/agents/issue-implementer.toml'))) as {
    model: string;
    model_reasoning_effort: string;
  };
  assert.deepEqual([codex.model, codex.model_reasoning_effort], ['gpt-6.1-sol', 'xhigh']);
  assert.deepEqual([implementer.model, implementer.model_reasoning_effort], ['gpt-6-luna', 'medium']);
});
