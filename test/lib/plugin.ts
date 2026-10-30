import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PathLike } from 'node:fs';
import type { TestContext } from 'node:test';
import type { Agent, Contract, Skill, SkillMetadata, SkillSettings } from './types.ts';
import { inside } from '../../scripts/markdown.ts';
export { inside, localLinks, markdown, walkReferences } from '../../scripts/markdown.ts';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { packagePlugin } from '../../scripts/package-plugins.ts';
import { validateManifests } from '../../scripts/validate-manifests.ts';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
export const pluginRoot = (name: string) => join(repository, 'plugins', name);
export const read = (path: PathLike) => readFile(path, 'utf8');
export const json = async <T = unknown>(path: PathLike): Promise<T> => JSON.parse(await read(path));

export async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), `Unexpected symlink: ${entry.name}`);
    if (entry.isDirectory())
      result.push(...(await files(join(root, entry.name))).map((path) => `${entry.name}/${path}`));
    else result.push(entry.name);
  }
  return result.sort();
}

export function frontmatter(source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  assert.ok(match, 'Missing YAML frontmatter');
  const metadata = parseYaml(match[1]!) as SkillMetadata;
  assert.ok(metadata && typeof metadata === 'object' && !Array.isArray(metadata), 'Invalid frontmatter');
  for (const key of ['name', 'description'] as const)
    assert.ok(typeof metadata[key] === 'string' && metadata[key].trim(), `Missing ${key}`);
  assert.match(metadata.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(metadata.name.length <= 64 && metadata.description.length <= 1024);
  return { metadata, body: source.slice(match[0].length) };
}

export async function loadPlugin(root: string) {
  const { manifest, codex } = await validateManifests(root);
  assert.equal(manifest.name, basename(root));
  assert.match(manifest.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  for (const key of ['name', 'version', 'description', 'author', 'license'] as const) {
    assert.ok(manifest[key], `Missing manifest ${key}`);
    assert.deepEqual(codex[key], manifest[key], `Inconsistent manifest ${key}`);
  }
  assert.match(manifest.$schema, /^https:\/\/agent-plugins\.org\/schemas\/.+\/plugin\.schema\.json$/);
  assert.equal(manifest.license, 'MIT');
  assert.match(await read(join(root, 'LICENSE')), /MIT License/);
  assert.ok(codex.interface.displayName && codex.interface.shortDescription);
  assert.equal(codex.skills, './skills/');
  const skillDirectory = inside(root, codex.skills);
  const skills = new Map<string, Skill>();
  for (const entry of await readdir(skillDirectory, { withFileTypes: true })) {
    assert.ok(entry.isDirectory(), `Unexpected skill entry: ${entry.name}`);
    const path = join(skillDirectory, entry.name);
    const skill = frontmatter(await read(join(path, 'SKILL.md')));
    assert.equal(skill.metadata.name, entry.name);
    const settings = parseYaml(await read(join(path, 'agents/openai.yaml'))) as SkillSettings;
    assert.ok(settings.interface.display_name && settings.interface.short_description);
    assert.equal(typeof settings.policy.allow_implicit_invocation, 'boolean');
    skills.set(entry.name, { ...skill, root: path, settings });
  }
  assert.ok(skills.size, 'No skills discovered');
  const agents = new Map<string, Agent>();
  let agentPaths: string[] = [];
  try {
    agentPaths = await files(join(root, 'com.openai/agents'));
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
  for (const path of agentPaths) {
    assert.ok(path.endsWith('.toml'), `Unexpected agent file: ${path}`);
    const agent = parseToml(await read(join(root, 'com.openai/agents', path))) as unknown as Agent;
    assert.equal(agent.name, basename(path, '.toml'));
    for (const key of ['description', 'model', 'model_reasoning_effort', 'developer_instructions'] as const)
      assert.ok(typeof agent[key] === 'string' && agent[key].trim(), `Missing agent ${key}`);
    agents.set(agent.name, agent);
  }
  return { root, manifest, codex, skills, agents };
}

export async function temporaryDirectory(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'plugin-contract-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return root;
}

// Exercise the same package boundary used by npm run package, including README.
export async function stagePlugin(t: TestContext, name: string) {
  const root = join(await temporaryDirectory(t), name);
  await packagePlugin(pluginRoot(name), root);
  return loadPlugin(root);
}

export function assertContract(source: string, contract: Contract) {
  for (const text of contract.contains ?? []) assert.ok(source.includes(text), `${contract.id}: missing ${text}`);
  for (const pattern of contract.matches ?? []) assert.match(source, new RegExp(pattern, 'u'), contract.id);
  for (const text of contract.excludes ?? []) assert.ok(!source.includes(text), `${contract.id}: forbidden ${text}`);
  let offset = 0;
  for (const text of contract.ordered ?? []) {
    const index = source.indexOf(text, offset);
    assert.ok(index >= offset, `${contract.id}: missing or out of order: ${text}`);
    offset = index + text.length;
  }
}
