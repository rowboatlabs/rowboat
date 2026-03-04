import fs from 'node:fs/promises';
import path from 'node:path';

const WIKI_LINK_REGEX = /\[\[([^[\]]+)\]\]/g;
const KNOWLEDGE_PREFIX = 'knowledge/';
const MARKDOWN_EXTENSION = '.md';

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

function isKnowledgeMarkdownPath(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath).replace(/^\/+/, '');
  const lower = normalized.toLowerCase();
  return lower.startsWith(KNOWLEDGE_PREFIX) && lower.endsWith(MARKDOWN_EXTENSION);
}

function stripKnowledgePrefix(relPath: string): string {
  const normalized = normalizeRelPath(relPath).replace(/^\/+/, '');
  if (!normalized.toLowerCase().startsWith(KNOWLEDGE_PREFIX)) return normalized;
  return normalized.slice(KNOWLEDGE_PREFIX.length);
}

function stripMarkdownExtension(wikiPath: string): string {
  return wikiPath.toLowerCase().endsWith(MARKDOWN_EXTENSION)
    ? wikiPath.slice(0, -MARKDOWN_EXTENSION.length)
    : wikiPath;
}

function toWikiPathCompareKey(wikiPath: string): string {
  return stripMarkdownExtension(wikiPath).toLowerCase();
}

function splitWikiPathPrefix(rawPath: string): { pathWithoutPrefix: string; hadKnowledgePrefix: boolean } {
  let normalized = rawPath.trim().replace(/^\/+/, '').replace(/^\.\//, '');
  const hadKnowledgePrefix = /^knowledge\//i.test(normalized);
  if (hadKnowledgePrefix) {
    normalized = normalized.slice(KNOWLEDGE_PREFIX.length);
  }
  return { pathWithoutPrefix: normalized, hadKnowledgePrefix };
}

function rewriteWikiLinksInMarkdown(
  markdown: string,
  fromWikiPath: string,
  toWikiPath: string,
  opts?: { allowBareSelfNameMatch?: boolean }
): string {
  const fromCompareKey = toWikiPathCompareKey(fromWikiPath);
  const fromBaseName = stripMarkdownExtension(fromWikiPath).split('/').pop()?.toLowerCase() ?? null;
  const toWikiPathWithoutExtension = stripMarkdownExtension(toWikiPath);
  const toBaseName = toWikiPathWithoutExtension.split('/').pop() ?? toWikiPathWithoutExtension;

  return markdown.replace(WIKI_LINK_REGEX, (fullMatch, innerRaw: string) => {
    const pipeIndex = innerRaw.indexOf('|');
    const pathAndAnchor = pipeIndex >= 0 ? innerRaw.slice(0, pipeIndex) : innerRaw;
    const aliasSuffix = pipeIndex >= 0 ? innerRaw.slice(pipeIndex) : '';

    const hashIndex = pathAndAnchor.indexOf('#');
    const pathPart = hashIndex >= 0 ? pathAndAnchor.slice(0, hashIndex) : pathAndAnchor;
    const anchorSuffix = hashIndex >= 0 ? pathAndAnchor.slice(hashIndex) : '';

    const leadingWhitespace = pathPart.match(/^\s*/)?.[0] ?? '';
    const trailingWhitespace = pathPart.match(/\s*$/)?.[0] ?? '';
    const rawPath = pathPart.trim();
    if (!rawPath) return fullMatch;

    const { pathWithoutPrefix, hadKnowledgePrefix } = splitWikiPathPrefix(rawPath);
    if (!pathWithoutPrefix) return fullMatch;

    const matchesFullPath = toWikiPathCompareKey(pathWithoutPrefix) === fromCompareKey;
    const isBareTarget = !pathWithoutPrefix.includes('/');
    const targetBaseName = stripMarkdownExtension(pathWithoutPrefix).toLowerCase();
    const matchesBareSelfName = Boolean(
      opts?.allowBareSelfNameMatch
      && fromBaseName
      && isBareTarget
      && targetBaseName === fromBaseName
    );
    if (!matchesFullPath && !matchesBareSelfName) {
      return fullMatch;
    }

    const preserveMarkdownExtension = rawPath.toLowerCase().endsWith(MARKDOWN_EXTENSION);
    const rewrittenPath = matchesBareSelfName
      ? (preserveMarkdownExtension ? `${toBaseName}.md` : toBaseName)
      : (preserveMarkdownExtension ? toWikiPath : toWikiPathWithoutExtension);
    const finalPath = hadKnowledgePrefix ? `${KNOWLEDGE_PREFIX}${rewrittenPath}` : rewrittenPath;

    return `[[${leadingWhitespace}${finalPath}${trailingWhitespace}${anchorSuffix}${aliasSuffix}]]`;
  });
}

async function collectKnowledgeMarkdownFiles(workspaceRoot: string): Promise<string[]> {
  const knowledgeRoot = path.join(workspaceRoot, 'knowledge');
  try {
    const stat = await fs.lstat(knowledgeRoot);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  const markdownFiles: string[] = [];
  const pendingDirectories: string[] = [knowledgeRoot];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) continue;

    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith(MARKDOWN_EXTENSION)) continue;

      const relativePath = normalizeRelPath(path.relative(workspaceRoot, absolutePath));
      markdownFiles.push(relativePath);
    }
  }

  return markdownFiles;
}

export async function rewriteWikiLinksForRenamedKnowledgeFile(
  workspaceRoot: string,
  fromRelPath: string,
  toRelPath: string
): Promise<number> {
  const normalizedFrom = normalizeRelPath(fromRelPath);
  const normalizedTo = normalizeRelPath(toRelPath);

  if (!isKnowledgeMarkdownPath(normalizedFrom) || !isKnowledgeMarkdownPath(normalizedTo)) {
    return 0;
  }

  const fromWikiPath = stripKnowledgePrefix(normalizedFrom);
  const toWikiPath = stripKnowledgePrefix(normalizedTo);
  if (toWikiPathCompareKey(fromWikiPath) === toWikiPathCompareKey(toWikiPath)) return 0;

  const markdownFiles = await collectKnowledgeMarkdownFiles(workspaceRoot);
  let rewrittenFiles = 0;

  const normalizedToLower = normalizedTo.toLowerCase();
  for (const relativePath of markdownFiles) {
    const absolutePath = path.join(workspaceRoot, ...relativePath.split('/'));
    try {
      const markdown = await fs.readFile(absolutePath, 'utf8');
      if (!markdown.includes('[[')) continue;

      const isRenamedFile = normalizeRelPath(relativePath).toLowerCase() === normalizedToLower;
      const rewritten = rewriteWikiLinksInMarkdown(markdown, fromWikiPath, toWikiPath, {
        allowBareSelfNameMatch: isRenamedFile,
      });
      if (rewritten === markdown) continue;

      await fs.writeFile(absolutePath, rewritten, 'utf8');
      rewrittenFiles += 1;
    } catch (error) {
      console.error('Failed to rewrite wiki links in file:', relativePath, error);
    }
  }

  return rewrittenFiles;
}
