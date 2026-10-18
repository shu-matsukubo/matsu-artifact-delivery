import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function fileList(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), `Unexpected symlink: ${entry.name}`);
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...(await fileList(path)).map((child) => `${entry.name}/${child}`));
    else {
      assert.ok(entry.isFile(), `Unexpected file type: ${entry.name}`);
      result.push(entry.name);
    }
  }
  return result.sort();
}

export async function compareInstallDirectories(actual: string, expected: string, label: string) {
  const actualFiles = await fileList(actual);
  const expectedFiles = await fileList(expected);
  assert.deepEqual(actualFiles, expectedFiles, `${label}: file list differs`);
  let bytes = 0;
  for (const path of expectedFiles) {
    const contents = await readFile(join(expected, path));
    assert.deepEqual(await readFile(join(actual, path)), contents, `${label}: content differs: ${path}`);
    bytes += contents.length;
  }
  return { files: expectedFiles.length, bytes };
}
