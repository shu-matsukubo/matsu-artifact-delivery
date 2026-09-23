import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import GithubSlugger from 'github-slugger';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
export const pluginRoot = (name) => join(repository, 'plugins', name);
export const read = (path) => readFile(path, 'utf8');
export const json = async (path) => JSON.parse(await read(path));

export function inside(root, path) {
  const result = resolve(root, path);
  const difference = relative(root, result);
  assert.ok(
    !isAbsolute(path) &&
      !win32.isAbsolute(path) &&
      difference !== '..' &&
      !difference.startsWith(`..${sep}`) &&
      !isAbsolute(difference),
    `Path escapes package: ${path}`,
  );
  return result;
}

export async function files(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), `Unexpected symlink: ${entry.name}`);
    if (entry.isDirectory())
      result.push(...(await files(join(root, entry.name))).map((path) => `${entry.name}/${path}`));
    else result.push(entry.name);
  }
  return result.sort();
}

export function frontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  assert.ok(match, 'Missing YAML frontmatter');
  const metadata = parseYaml(match[1]);
  assert.ok(metadata && typeof metadata === 'object' && !Array.isArray(metadata), 'Invalid frontmatter');
  for (const key of ['name', 'description'])
    assert.ok(typeof metadata[key] === 'string' && metadata[key].trim(), `Missing ${key}`);
  assert.match(metadata.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(metadata.name.length <= 64 && metadata.description.length <= 1024);
  return { metadata, body: source.slice(match[0].length) };
}

export async function loadPlugin(root) {
  const manifest = await json(join(root, 'plugin.json'));
  const codex = await json(join(root, '.codex-plugin/plugin.json'));
  assert.equal(manifest.name, basename(root));
  assert.match(manifest.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  for (const key of ['name', 'version', 'description', 'author', 'license']) {
    assert.ok(manifest[key], `Missing manifest ${key}`);
    assert.deepEqual(codex[key], manifest[key], `Inconsistent manifest ${key}`);
  }
  assert.match(manifest.$schema, /^https:\/\/agent-plugins\.org\/schemas\/.+\/plugin\.schema\.json$/);
  assert.equal(manifest.license, 'MIT');
  assert.match(await read(join(root, 'LICENSE')), /MIT License/);
  assert.ok(codex.interface.displayName && codex.interface.shortDescription);
  assert.equal(codex.skills, './skills/');
  const skillDirectory = inside(root, codex.skills);
  const skills = new Map();
  for (const entry of await readdir(skillDirectory, { withFileTypes: true })) {
    assert.ok(entry.isDirectory(), `Unexpected skill entry: ${entry.name}`);
    const path = join(skillDirectory, entry.name);
    const skill = frontmatter(await read(join(path, 'SKILL.md')));
    assert.equal(skill.metadata.name, entry.name);
    const settings = parseYaml(await read(join(path, 'agents/openai.yaml')));
    assert.ok(settings.interface.display_name && settings.interface.short_description);
    assert.equal(typeof settings.policy.allow_implicit_invocation, 'boolean');
    skills.set(entry.name, { ...skill, root: path, settings });
  }
  assert.ok(skills.size, 'No skills discovered');
  const agents = new Map();
  for (const path of await files(join(root, 'com.openai/agents'))) {
    assert.ok(path.endsWith('.toml'), `Unexpected agent file: ${path}`);
    const agent = parseToml(await read(join(root, 'com.openai/agents', path)));
    assert.equal(agent.name, basename(path, '.toml'));
    for (const key of ['description', 'model', 'model_reasoning_effort', 'developer_instructions'])
      assert.ok(typeof agent[key] === 'string' && agent[key].trim(), `Missing agent ${key}`);
    agents.set(agent.name, agent);
  }
  return { root, manifest, codex, skills, agents };
}

export function markdown(source) {
  const tokens = marked.lexer(source);
  const links = [];
  const headings = [];
  const slugger = new GithubSlugger();
  const plain = (items) => items.map((token) => (token.tokens ? plain(token.tokens) : (token.text ?? ''))).join('');
  marked.walkTokens(tokens, (token) => {
    if (token.type === 'link' || token.type === 'image') links.push(token.href);
    if (token.type === 'heading') headings.push(slugger.slug(plain(token.tokens)));
  });
  return { links, headings, tokens };
}

export async function localLinks(root, path) {
  const { links } = markdown(await read(inside(root, path)));
  const result = [];
  for (const href of links) {
    if (/^(https?:|mailto:)/i.test(href)) continue;
    const [target, fragment] = href.split('#');
    assert.ok(!target.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(target), `Unsupported link: ${href}`);
    const absolute = inside(root, target ? join(dirname(path), decodeURIComponent(target)) : path);
    const info = await stat(absolute);
    if (fragment) {
      assert.ok(info.isFile(), `Anchor on directory: ${href}`);
      assert.ok(
        markdown(await read(absolute)).headings.includes(decodeURIComponent(fragment)),
        `Broken anchor: ${path} -> ${href}`,
      );
    }
    result.push(relative(root, absolute).split(sep).join('/'));
  }
  return result;
}

export async function walkReferences(root, start = 'SKILL.md') {
  const visited = new Set();
  const pending = [start];
  while (pending.length) {
    const path = pending.pop();
    if (visited.has(path)) continue;
    visited.add(path);
    if (path.endsWith('.md')) pending.push(...(await localLinks(root, path)));
  }
  return [...visited].sort();
}

export async function temporaryDirectory(t) {
  const root = await mkdtemp(join(tmpdir(), 'plugin-contract-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return root;
}

// Stage runtime inputs only. Deliberately exclude repository config, tests and node_modules.
export async function stagePlugin(t, name) {
  const root = join(await temporaryDirectory(t), name);
  for (const path of ['plugin.json', '.codex-plugin', 'LICENSE', 'skills', 'com.openai']) {
    await cp(join(pluginRoot(name), path), join(root, path), { recursive: true });
  }
  if (name === 'artifact-workflow') {
    for (const path of [
      'mcp.json',
      '.mcp.json',
      'mcp/task-memory.cjs',
      'mcp/task-memory.cjs.LEGAL.txt',
      'mcp/THIRD_PARTY_LICENSES.txt',
    ]) {
      await cp(join(pluginRoot(name), path), join(root, path), { recursive: true });
    }
  }
  return loadPlugin(root);
}

export function assertContract(source, contract) {
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
