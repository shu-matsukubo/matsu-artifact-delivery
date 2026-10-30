import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { markdown, plainMarkdownText } from '../../../../scripts/markdown.ts';
import { parse as parseYaml } from 'yaml';

const allowedSections = new Set(['概要', '制約', '制約と責務範囲', '制約・責務範囲', 'フロー']);
const constraintSections = ['制約', '制約と責務範囲', '制約・責務範囲'];

function anchors(source: string) {
  return new Set(markdown(source).headings);
}

export async function validateSkill(input: string): Promise<string[]> {
  const skillFile = resolve(input.endsWith('SKILL.md') ? input : resolve(input, 'SKILL.md'));
  const errors: string[] = [];
  let source: string;
  try {
    source = await readFile(skillFile, 'utf8');
  } catch {
    return [`SKILL.md を読み込めない: ${skillFile}`];
  }

  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!frontmatter) return ['YAML frontmatter がない'];
  let metadata: unknown;
  try {
    metadata = parseYaml(frontmatter[1]!, { uniqueKeys: true });
  } catch {
    errors.push('YAML frontmatter を解析できない');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    errors.push('YAML frontmatter は name と description を含むオブジェクトであること');
  } else {
    const fields = metadata as Record<string, unknown>;
    const name = fields.name;
    const description = fields.description;
    if (
      typeof name !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
      name.length > 64 ||
      name !== basename(dirname(skillFile))
    )
      errors.push('name はディレクトリ名と一致する小文字・数字・ハイフンの識別子であること');
    if (typeof description !== 'string' || !description.trim() || description.length > 1024)
      errors.push('description は 1〜1024 文字の説明であること');
  }

  const body = source.slice(frontmatter[0].length);
  const parsed = markdown(body);
  const sections: string[] = [];
  let hasTitle = false;
  for (const token of parsed.tokens) {
    if (token.type !== 'heading') continue;
    if (token.depth === 1) hasTitle = true;
    if (token.depth === 2) sections.push(plainMarkdownText(token.tokens ?? []).trim());
  }
  if (!hasTitle) errors.push('Skill のタイトル（第1見出し）がない');
  for (const section of sections) {
    if (!allowedSections.has(section)) errors.push(`SKILL.md に対象外の第2見出しがある: ${section}`);
  }
  if (!sections.includes('概要')) errors.push('「## 概要」がない');
  if (!sections.includes('フロー')) errors.push('「## フロー」がない');
  const overviewIndex = sections.indexOf('概要');
  const constraintIndex = sections.findIndex((section) => constraintSections.includes(section));
  const flowIndex = sections.indexOf('フロー');
  if (
    overviewIndex >= 0 &&
    constraintIndex >= 0 &&
    flowIndex >= 0 &&
    !(overviewIndex < constraintIndex && constraintIndex < flowIndex)
  )
    errors.push('セクションの順序は 概要 → 制約と責務範囲 → フロー とする');
  if (constraintSections.filter((section) => sections.includes(section)).length !== 1)
    errors.push('制約・責務範囲の第2見出しは一つだけにする');
  for (const section of new Set(sections)) {
    if (sections.filter((value) => value === section).length > 1) errors.push(`第2見出しが重複している: ${section}`);
  }

  for (const destination of parsed.links) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(destination)) continue;
    const [rawPath = '', rawFragment] = destination.split('#', 2);
    const path = rawPath.split('?')[0]!;
    let target: string;
    try {
      target = path ? resolve(dirname(skillFile), decodeURIComponent(path)) : skillFile;
    } catch {
      errors.push(`リンク先を解釈できない: ${destination}`);
      continue;
    }
    const info = await stat(target).catch(() => null);
    if (!info) {
      errors.push(`ローカルリンク切れ: ${destination}`);
      continue;
    }
    if (rawFragment) {
      let fragment: string;
      try {
        fragment = decodeURIComponent(rawFragment);
      } catch {
        errors.push(`アンカーを解釈できない: ${destination}`);
        continue;
      }
      if (!info.isFile() || !target.endsWith('.md')) {
        errors.push(`Markdown アンカーの対象が Markdown ファイルではない: ${destination}`);
        continue;
      }
      const targetSource = await readFile(target, 'utf8');
      if (!anchors(targetSource).has(fragment)) errors.push(`ローカルアンカー切れ: ${destination}`);
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const targets = process.argv.slice(2);
  if (!targets.length) {
    console.error('Usage: node validate-skill.ts <SKILL.md or skill-directory> [...]');
    process.exitCode = 2;
  } else {
    for (const target of targets) {
      const errors = await validateSkill(target);
      if (errors.length) {
        console.error(`${target}:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
        process.exitCode = 1;
      } else console.log(`${target}: OK`);
    }
  }
}
