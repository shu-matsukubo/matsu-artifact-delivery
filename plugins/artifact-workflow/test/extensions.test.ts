import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { extensionsDirectory } from '../mcp/src/config.js';
import { ExtensionStore } from '../mcp/src/extensions.js';
import { PlanStore } from '../mcp/src/store.js';
import { code, plan, temporaryDirectory } from './fixtures.js';

const entry = {
  id: 'csv-report',
  name: 'CSV report',
  type: 'generation' as const,
  target: 'CSVレポート',
  applicability: '入力がCSVでレポート生成を求められた場合',
  summary: 'CSVの列と値を保持して記述する',
  instructions: '与えられたCSVの列と値をそのまま参照し、依頼されたレポートだけを作成する。',
  dependencies: ['Skill: spreadsheets'],
};

await test('extension registry persists independently with lightweight filtering and revision guarded CRUD', async (t) => {
  const directory = await temporaryDirectory(t);
  const first = new ExtensionStore(join(directory, 'extensions'));
  const created = await first.create(entry);
  assert.equal((await first.list()).length, 1);
  assert.equal((await first.list({ type: 'review' })).length, 1);
  assert.equal((await first.list())[0]!.type, 'artifact');
  assert.equal((await first.list({ query: 'CSV' })).length, 1);
  assert.equal('instructions' in (await first.list())[0]!, false);
  assert.deepEqual(await new ExtensionStore(first.directory).get(entry.id), created);
  await assert.rejects(first.create(entry), code('SESSION_EXISTS'));
  const changed = await first.update(entry.id, created.revision, { ...entry, summary: '更新済み' });
  assert.equal(changed?.summary, '更新済み');
  await assert.rejects(first.update(entry.id, created.revision, entry), code('REVISION_CONFLICT'));
  await assert.rejects(first.delete(entry.id, created.revision), code('REVISION_CONFLICT'));
  await assert.rejects(
    first.update(entry.id, changed!.revision, { ...entry, id: 'different-id' }),
    code('INVALID_DATA'),
  );
  assert.equal(await first.delete(entry.id, changed!.revision), true);
  assert.equal(await first.get(entry.id), null);
  assert.equal(await first.delete(entry.id, changed!.revision), false);
});

await test('legacy generation and review entries normalize in memory and migrate on the next write', async (t) => {
  const directory = await temporaryDirectory(t);
  const filename = join(directory, 'extensions.json');
  const legacyGeneration = {
    ...entry,
    type: 'generation',
    revision: '34aaa4b2-9a1a-4b7e-9e13-2bbbc8a133e4',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const legacyReview = { ...legacyGeneration, id: 'old-review', type: 'review' };
  await writeFile(filename, JSON.stringify({ schemaVersion: 1, entries: [legacyGeneration, legacyReview] }));
  const store = new ExtensionStore(directory);
  assert.equal((await store.list({ type: 'generation' })).length, 2);
  assert.equal((await store.get('old-review'))?.type, 'artifact');
  assert.deepEqual(JSON.parse(await readFile(filename, 'utf8')), {
    schemaVersion: 1,
    entries: [legacyGeneration, legacyReview],
  });
  await store.update('csv-report', legacyGeneration.revision, {
    ...entry,
    summary: '保存時に共通形式へ移行',
  });
  const migrated = JSON.parse(await readFile(filename, 'utf8')) as {
    schemaVersion: number;
    entries: { type: string }[];
  };
  assert.equal(migrated.schemaVersion, 2);
  assert.ok(migrated.entries.every(({ type }) => type === 'artifact'));
});

await test('a saved plan keeps its policy snapshot when the registry updates or a stale update conflicts', async (t) => {
  const directory = await temporaryDirectory(t);
  const extensions = new ExtensionStore(join(directory, 'extensions'));
  const plans = new PlanStore(join(directory, 'plans'));
  const registered = await extensions.create({ ...entry, type: 'artifact' });
  const selected = {
    status: 'selected' as const,
    id: registered.id,
    name: registered.name,
    revision: registered.revision,
    target: registered.target,
    applicability: registered.applicability,
    summary: registered.summary,
    instructions: registered.instructions,
    dependencies: registered.dependencies,
    reason: '対象成果物と適用条件が一致した',
  };
  const agreedPlan = {
    ...plan,
    tasks: [{ ...plan.tasks[0]!, extensionPolicy: selected }],
  };
  const empty = await plans.initialize('policy-snapshot');
  await plans.save('policy-snapshot', empty.revision, agreedPlan);
  await extensions.update(registered.id, registered.revision, { ...entry, type: 'artifact', summary: '更新後の概要' });
  const persisted = await plans.get('policy-snapshot');
  assert.deepEqual(persisted?.plan, agreedPlan);
  await assert.rejects(
    extensions.update(registered.id, registered.revision, { ...entry, type: 'artifact', summary: '競合する更新' }),
    code('REVISION_CONFLICT'),
  );
  assert.deepEqual((await plans.get('policy-snapshot'))?.plan, agreedPlan);
});

await test('registry size limit rejects before replacing the previous valid registry', async (t) => {
  const directory = await temporaryDirectory(t);
  const store = new ExtensionStore(directory);
  for (let index = 0; index < 40; index++) {
    try {
      await store.create({
        ...entry,
        id: `large-${index}`,
        instructions: '指示'.repeat(30_000),
        dependencies: Array(100).fill('dependency'.repeat(100)),
      });
    } catch (error) {
      assert.equal(code('INVALID_DATA')(error), true);
      const persisted = JSON.parse(await readFile(join(directory, 'extensions.json'), 'utf8')) as {
        entries: unknown[];
      };
      assert.ok(persisted.entries.length > 0 && persisted.entries.length < 40);
      return;
    }
  }
  assert.fail('Expected the bounded registry write to fail before 5 MiB.');
});

await test('invalid records and damaged registries fail closed without replacing existing bytes', async (t) => {
  const directory = await temporaryDirectory(t);
  const store = new ExtensionStore(directory);
  await assert.rejects(store.create({ ...entry, type: 'unknown' }));
  await mkdir(directory, { recursive: true });
  const filename = join(directory, 'extensions.json');
  await writeFile(filename, '{broken');
  await assert.rejects(store.list(), code('INVALID_DATA'));
  assert.equal(await readFile(filename, 'utf8'), '{broken');
  await writeFile(
    filename,
    JSON.stringify({ schemaVersion: 1, entries: [{ ...entry, revision: 'bad', createdAt: 'bad', updatedAt: 'bad' }] }),
  );
  await assert.rejects(store.list(), code('INVALID_DATA'));
});

await test('extension storage has a durable platform user-state default and plugin-data sibling', () => {
  assert.ok(extensionsDirectory({}).includes('matsu-artifact-workflow'));
  assert.equal(
    extensionsDirectory({ PLUGIN_DATA: join(process.cwd(), 'plugin-data') }),
    join(process.cwd(), 'plugin-data', 'extensions'),
  );
  assert.equal(
    extensionsDirectory({ ARTIFACT_WORKFLOW_EXTENSIONS_DIR: join(process.cwd(), 'custom') }),
    join(process.cwd(), 'custom'),
  );
  assert.throws(
    () => extensionsDirectory({ ARTIFACT_WORKFLOW_EXTENSIONS_DIR: './relative' }),
    code('INVALID_DIRECTORY'),
  );
});
