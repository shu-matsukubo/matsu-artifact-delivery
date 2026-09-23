import assert from 'node:assert/strict';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { assertReadOnly } from '../lib/contract-suite.mjs';
import {
  assertContract,
  frontmatter,
  inside,
  json,
  loadPlugin,
  localLinks,
  markdown,
  read,
  stagePlugin,
  temporaryDirectory,
  walkReferences,
} from '../lib/plugin.mjs';

await test('HAR-U01: frontmatter parses YAML and rejects absent, duplicate or invalid metadata', () => {
  const source = '---\r\nname: sample\r\ndescription: Sample skill\r\n---\r\n# Body';
  assert.deepEqual(frontmatter(source), {
    metadata: { name: 'sample', description: 'Sample skill' },
    body: '# Body',
  });
  for (const invalid of [
    '# Body',
    '---\n[]\n---\n',
    '---\nname: sample\n---\n',
    '---\nname: Invalid Name\ndescription: test\n---\n',
    '---\nname: sample\nname: duplicate\ndescription: test\n---\n',
    `---\nname: sample\ndescription: ${'x'.repeat(1025)}\n---\n`,
  ])
    assert.throws(() => frontmatter(invalid));
});

await test('HAR-U02: Markdown parser handles reference links, images, code fences and duplicate headings', () => {
  const source =
    '# **日本語** `heading`\n\n# **日本語** `heading`\n\n[reference][ref]\n\n![asset](image.png)\n\n[ref]: target.md#section\n\n```md\n[example](missing.md)\n```';
  const parsed = markdown(source);
  assert.deepEqual(parsed.links, ['target.md#section', 'image.png']);
  assert.deepEqual(parsed.headings, ['日本語-heading', '日本語-heading-1']);
});

await test('HAR-U03: package path checks accept local parents and reject absolute or escaping paths', async (t) => {
  const root = await temporaryDirectory(t);
  assert.equal(inside(root, 'references/../SKILL.md'), join(root, 'SKILL.md'));
  for (const path of ['../other.md', '/outside', 'C:\\outside', '\\\\server\\share'])
    assert.throws(() => inside(root, path), /escapes package/);
});

await test('HAR-U04: local reference graph handles cycles and rejects broken files, anchors and escapes', async (t) => {
  const root = await temporaryDirectory(t);
  await writeFile(join(root, 'SKILL.md'), '[child](child.md#section)\n[web](https://example.invalid)');
  await writeFile(join(root, 'child.md'), '# Section\n[parent](SKILL.md)');
  assert.deepEqual(await walkReferences(root), ['SKILL.md', 'child.md']);
  await writeFile(join(root, 'child.md'), '[missing](missing.md)');
  await assert.rejects(localLinks(root, 'child.md'), { code: 'ENOENT' });
  await writeFile(join(root, 'child.md'), '# Changed');
  await assert.rejects(walkReferences(root), /Broken anchor/);
  for (const link of ['../escape.md', '%2e%2e/escape.md', 'file:secret', '//server/share']) {
    await writeFile(join(root, 'child.md'), `[invalid](${link})`);
    await assert.rejects(localLinks(root, 'child.md'));
  }
});

await test('HAR-U05: packaged metadata mismatches and invalid Agent / YAML syntax fail validation', async (t) => {
  const plugin = await stagePlugin(t, 'expert-escalation');
  const manifestPath = join(plugin.root, '.codex-plugin/plugin.json');
  const original = await read(manifestPath);
  await writeFile(manifestPath, JSON.stringify({ ...(await json(manifestPath)), version: '999.0.0' }));
  await assert.rejects(loadPlugin(plugin.root), /Inconsistent manifest version/);
  await writeFile(manifestPath, original);
  const agentPath = join(plugin.root, 'com.openai/agents/escalation-advisor.toml');
  const agent = await read(agentPath);
  await writeFile(agentPath, 'name = [');
  await assert.rejects(loadPlugin(plugin.root));
  await writeFile(agentPath, agent);
  const settings = join(plugin.root, 'skills/expert-escalation/agents/openai.yaml');
  await writeFile(settings, 'policy: [');
  await assert.rejects(loadPlugin(plugin.root));
});

await test('HAR-U06: missing Skills, empty Agent instructions and lost read-only settings are detected', async (t) => {
  const plugin = await stagePlugin(t, 'expert-escalation');
  for (const field of ['sandbox_mode', 'approval_policy', 'agents']) {
    const role = { ...plugin.agents.get('escalation-advisor') };
    delete role[field];
    assert.throws(() => assertReadOnly(role));
  }
  const agentPath = join(plugin.root, 'com.openai/agents/escalation-advisor.toml');
  await writeFile(
    agentPath,
    (await read(agentPath)).replace(/developer_instructions = """[\s\S]*?"""/, 'developer_instructions = ""'),
  );
  await assert.rejects(loadPlugin(plugin.root), /Missing agent developer_instructions/);
  await unlink(join(plugin.root, 'skills/expert-escalation/SKILL.md'));
  await assert.rejects(loadPlugin(plugin.root), { code: 'ENOENT' });
});

await test('HAR-U07: contract assertions detect removed clauses, prohibited content, patterns and sequence changes', () => {
  const rule = {
    id: 'sample',
    contains: ['parent'],
    matches: ['read.only'],
    excludes: ['delegate'],
    ordered: ['self', 'independent', 'verify'],
  };
  const source = 'parent read-only self independent verify';
  assertContract(source, rule);
  for (const changed of [
    source.replace('parent', 'worker'),
    source.replace('read-only', 'write'),
    `${source} delegate`,
    source.replace('self independent', 'independent self'),
    source.replace('verify', ''),
  ]) {
    assert.throws(() => assertContract(changed, rule));
  }
  assertContract('', { id: 'empty' });
});

await test('HAR-U08: nested directories and local non-Markdown assets participate in discovery', async (t) => {
  const root = await temporaryDirectory(t);
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'SKILL.md'), '![image](assets/image.svg)\n[assets](assets/)');
  await writeFile(join(root, 'assets/image.svg'), '<svg/>');
  assert.deepEqual(await walkReferences(root), ['SKILL.md', 'assets', 'assets/image.svg']);
});
