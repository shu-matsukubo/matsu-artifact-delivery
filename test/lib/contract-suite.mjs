import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertContract,
  files,
  inside,
  json,
  loadPlugin,
  localLinks,
  pluginRoot,
  read,
  repository,
} from './plugin.mjs';

export function assertReadOnly(agent) {
  assert.equal(agent.sandbox_mode, 'read-only', `${agent.name}: sandbox`);
  assert.equal(agent.approval_policy, 'never', `${agent.name}: approvals`);
  assert.equal(agent.agents?.enabled, false, `${agent.name}: delegation`);
}

export async function registerContracts({ name, prefix, implicit, agents, readOnly }, casesUrl) {
  const root = pluginRoot(name);
  const cases = await json(casesUrl);
  await test(`${prefix}-U01: Plugin / Skill / Agent metadata and permissions`, async () => {
    const plugin = await loadPlugin(root);
    assert.equal(await read(join(root, 'LICENSE')), await read(join(repository, 'LICENSE')));
    await localLinks(repository, `plugins/${name}/README.md`);
    assert.deepEqual([...plugin.skills.keys()], [name]);
    assert.equal(plugin.skills.get(name).settings.policy.allow_implicit_invocation, implicit);
    assert.deepEqual([...plugin.agents.keys()].sort(), agents.toSorted());
    readOnly.forEach((role) => assertReadOnly(plugin.agents.get(role)));
    assert.ok(plugin.codex.interface.defaultPrompt.some((prompt) => prompt.includes(`$${name}`)));
    for (const skill of plugin.skills.values()) {
      assert.ok(skill.metadata.compatibility);
      assert.doesNotMatch(skill.body, /\bgpt-\d/, 'Models belong in Agent configuration');
    }
  });
  await test(`${prefix}-U02: every Skill document and Agent has a contract; all local links resolve`, async () => {
    const skillFiles = (await files(join(root, 'skills'))).map((path) => `skills/${path}`);
    const roleFiles = (await files(join(root, 'com.openai/agents'))).map((path) => `com.openai/agents/${path}`);
    for (const path of skillFiles)
      assert.ok(
        path.endsWith('.md') || path.endsWith('/agents/openai.yaml'),
        `New Skill implementation needs a unit test: ${path}`,
      );
    const required = [...skillFiles.filter((path) => path.endsWith('.md')), ...roleFiles];
    assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length, 'Duplicate contract IDs');
    for (const path of required)
      assert.ok(
        cases.some((item) => item.file === path),
        `No unit contract: ${path}`,
      );
    const inventory = await read(join(repository, 'docs/testing.md'));
    for (const item of cases) {
      assert.ok(inventory.includes(item.id), `Undocumented contract: ${item.id}`);
      assert.match(item.id, new RegExp(`^${prefix}-U\\d{2}$`));
      assert.ok(item.title && required.includes(item.file), `Unknown contract target: ${item.file}`);
      assert.ok(
        ['contains', 'matches', 'excludes', 'ordered'].some((key) => item[key]?.length),
        `Empty contract: ${item.id}`,
      );
    }
    for (const path of skillFiles.filter((file) => file.endsWith('.md'))) await localLinks(root, path);
  });
  for (const contract of cases) {
    await test(`${contract.id}: ${contract.title}`, async () => {
      assertContract(await read(inside(root, contract.file)), contract);
    });
  }
}
