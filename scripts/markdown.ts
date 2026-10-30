import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import GithubSlugger from 'github-slugger';
import { marked, type Token } from 'marked';

export function inside(root: string, path: string) {
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

export function plainMarkdownText(tokens: Token[]): string {
  return tokens
    .map((token) =>
      'tokens' in token && token.tokens ? plainMarkdownText(token.tokens) : 'text' in token ? token.text : '',
    )
    .join('');
}

export function markdown(source: string) {
  const tokens = marked.lexer(source);
  const links: string[] = [];
  const headings: string[] = [];
  const slugger = new GithubSlugger();
  void marked.walkTokens(tokens, (token) => {
    if (token.type === 'link' || token.type === 'image') links.push(token.href);
    if (token.type === 'heading') headings.push(slugger.slug(plainMarkdownText(token.tokens ?? [])));
  });
  return { links, headings, tokens };
}

export async function localLinks(root: string, path: string) {
  const { links } = markdown(await readFile(inside(root, path), 'utf8'));
  const result = [];
  for (const href of links) {
    if (/^(https?:|mailto:)/i.test(href)) continue;
    const [target = '', fragment] = href.split('#');
    assert.ok(!target.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(target), `Unsupported link: ${href}`);
    const absolute = inside(root, target ? join(dirname(path), decodeURIComponent(target)) : path);
    const info = await stat(absolute);
    if (fragment) {
      assert.ok(info.isFile(), `Anchor on directory: ${href}`);
      assert.ok(
        markdown(await readFile(absolute, 'utf8')).headings.includes(decodeURIComponent(fragment)),
        `Broken anchor: ${path} -> ${href}`,
      );
    }
    result.push(relative(root, absolute).split(sep).join('/'));
  }
  return result;
}

export async function walkReferences(root: string, start = 'SKILL.md') {
  const visited = new Set<string>();
  const pending = [start];
  while (pending.length) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    if (path.endsWith('.md')) pending.push(...(await localLinks(root, path)));
  }
  return [...visited].sort();
}
