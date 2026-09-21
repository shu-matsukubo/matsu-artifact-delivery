import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { dataDirectory } from '../mcp/src/config.js';
import { code } from './fixtures.js';

await test('storage defaults outside the project and accepts only absolute overrides', () => {
  assert.ok(dataDirectory({}).includes('matsu-artifact-workflow'));
  assert.equal(
    dataDirectory({ PLUGIN_DATA: join(process.cwd(), 'fixture') }),
    join(process.cwd(), 'fixture', 'task-memory'),
  );
  assert.throws(() => dataDirectory({ ARTIFACT_WORKFLOW_DATA_DIR: './tasks' }), code('INVALID_DIRECTORY'));
});

await test('an explicit data directory takes precedence over plugin data', () => {
  const explicit = join(process.cwd(), 'override');
  assert.equal(
    dataDirectory({
      ARTIFACT_WORKFLOW_DATA_DIR: explicit,
      PLUGIN_DATA: './invalid-when-used',
    }),
    explicit,
  );
  assert.throws(() => dataDirectory({ PLUGIN_DATA: './relative' }), code('INVALID_DIRECTORY'));
});
