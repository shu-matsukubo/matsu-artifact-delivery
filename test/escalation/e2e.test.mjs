import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { assertReadOnly } from '../lib/contract-suite.mjs';
import { files, read, stagePlugin, walkReferences } from '../lib/plugin.mjs';

await test('EX-E01: standalone package discovers the Skill, both advisors and all references', async (t) => {
  const plugin = await stagePlugin(t, 'expert-escalation');
  assert.deepEqual(await readdir(join(plugin.root, '..')), ['expert-escalation']);
  assert.equal(plugin.codex.mcpServers, undefined);
  const skill = plugin.skills.get('expert-escalation');
  assert.equal(skill.settings.policy.allow_implicit_invocation, true);
  assert.deepEqual(
    await walkReferences(skill.root),
    (await files(skill.root)).filter((file) => file.endsWith('.md')),
  );
  assert.deepEqual([...plugin.agents.keys()].sort(), ['escalation-advisor', 'escalation-deep-advisor']);
  for (const agent of plugin.agents.values()) {
    assertReadOnly(agent);
    assert.ok(skill.body.includes(`\`${agent.name}\``));
  }
});

await test('EX-E02: Skill → advisor contract → both roles → result template preserve states and identity', async (t) => {
  const plugin = await stagePlugin(t, 'expert-escalation');
  const root = plugin.skills.get('expert-escalation').root;
  const contract = await read(join(root, 'references/advisor-contract.md'));
  const template = await read(join(root, 'assets/escalation-result-template.md'));
  for (const value of [
    '相談ID',
    '親識別子',
    'advice',
    'input_insufficient',
    'inconclusive',
    'human_decision_required',
  ]) {
    assert.ok(contract.includes(value), value);
    assert.ok(template.includes(value), value);
    for (const agent of plugin.agents.values())
      assert.ok(agent.developer_instructions.includes(value), `${agent.name}: ${value}`);
  }
  for (const value of [
    'attempted',
    'execution_state',
    'unavailable',
    'no_result',
    'not_started',
    'running',
    'completed',
    'stopped',
    'unknown',
  ]) {
    assert.ok(contract.includes(value), value);
    assert.ok(template.includes(value), value);
  }
});
