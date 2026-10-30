import { readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSkill } from '../.agents/skills/plugin-skill-authoring/scripts/validate-skill.ts';
import { walkReferences } from './markdown.ts';

export async function discoverSkills(root = resolve('.')): Promise<string[]> {
  const skillRoots = [join(root, '.agents/skills')];
  for (const entry of await readdir(join(root, 'plugins'), { withFileTypes: true })) {
    if (entry.isDirectory()) skillRoots.push(join(root, 'plugins', entry.name, 'skills'));
  }

  const result: string[] = [];
  for (const skillRoot of skillRoots) {
    const entries = await readdir(skillRoot, { withFileTypes: true }).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (entry.isDirectory()) result.push(join(skillRoot, entry.name, 'SKILL.md'));
    }
  }
  return result.sort();
}

export async function checkSkills(root = resolve('.')): Promise<string[]> {
  const skillFiles = await discoverSkills(root);
  if (!skillFiles.length) return ['Skill が見つからない'];
  const errors: string[] = [];
  for (const file of skillFiles) {
    for (const error of await validateSkill(file)) errors.push(`${file}: ${error}`);
    const components = relative(root, file).split(sep);
    const boundary = components[0] === 'plugins' ? join(root, 'plugins', components[1]!) : root;
    const entry = relative(boundary, file).split(sep).join('/');
    try {
      await walkReferences(boundary, entry);
    } catch (error) {
      errors.push(
        `${file}: Markdown 参照グラフを検査できない: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return errors;
}

export async function main() {
  const errors = await checkSkills();
  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Skill 構造・参照グラフ: ${await discoverSkills().then((files) => files.length)} 件 OK`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
