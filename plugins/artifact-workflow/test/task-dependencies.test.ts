import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTaskDependencies } from '../mcp/src/task-dependencies.js';

await test('shared dependencies, forward references, and disconnected tasks are valid', () => {
  const tasks = [
    { id: 'D', dependsOn: ['B', 'C'] },
    { id: 'B', dependsOn: ['A'] },
    { id: 'C', dependsOn: ['A'] },
    { id: 'A', dependsOn: [] },
    { id: 'E', dependsOn: [] },
  ];
  const before = structuredClone(tasks);
  assert.deepEqual(validateTaskDependencies(tasks), []);
  assert.deepEqual(tasks, before);
});

await test('duplicate IDs report their location without guessing an ambiguous cycle', () => {
  assert.deepEqual(
    validateTaskDependencies([
      { id: 'A', dependsOn: ['B'] },
      { id: 'A', dependsOn: [] },
      { id: 'B', dependsOn: ['A'] },
    ]),
    [{ kind: 'duplicate_id', taskIndex: 1 }],
  );
});

await test('missing references report each dependency position without being called cycles', () => {
  assert.deepEqual(
    validateTaskDependencies([
      { id: 'A', dependsOn: ['missing'] },
      { id: 'B', dependsOn: ['A', 'missing'] },
    ]),
    [
      { kind: 'missing_dependency', taskIndex: 0, dependencyIndex: 0 },
      { kind: 'missing_dependency', taskIndex: 1, dependencyIndex: 1 },
    ],
  );
});

await test('self references and cycles in disconnected components are detected', () => {
  assert.deepEqual(
    validateTaskDependencies([
      { id: 'A', dependsOn: ['A'] },
      { id: 'B', dependsOn: ['C'] },
      { id: 'C', dependsOn: ['D'] },
      { id: 'D', dependsOn: ['B'] },
    ]),
    [
      { kind: 'cycle', taskIndex: 0, dependencyIndex: 0 },
      { kind: 'cycle', taskIndex: 3, dependencyIndex: 0 },
    ],
  );
});

await test('a missing reference does not hide a separate valid-edge cycle', () => {
  assert.deepEqual(
    validateTaskDependencies([
      { id: 'A', dependsOn: ['missing', 'B'] },
      { id: 'B', dependsOn: ['A'] },
    ]),
    [
      { kind: 'missing_dependency', taskIndex: 0, dependencyIndex: 0 },
      { kind: 'cycle', taskIndex: 1, dependencyIndex: 0 },
    ],
  );
});

await test('a maximum-length task chain is valid', () => {
  const tasks = Array.from({ length: 200 }, (_, index) => ({
    id: `T${index}`,
    dependsOn: index === 199 ? [] : [`T${index + 1}`],
  }));
  assert.deepEqual(validateTaskDependencies(tasks), []);
});
