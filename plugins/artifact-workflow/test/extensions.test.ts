import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { extensionsDirectory } from '../mcp/src/config.js';
import { ExtensionStore } from '../mcp/src/extensions.js';
import { code, temporaryDirectory } from './fixtures.js';

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
  assert.equal((await first.list({ type: 'review' })).length, 0);
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
