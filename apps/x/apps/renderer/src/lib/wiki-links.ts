const KNOWLEDGE_PREFIX = 'knowledge/'

export const stripKnowledgePrefix = (path: string) =>
  path.startsWith(KNOWLEDGE_PREFIX) ? path.slice(KNOWLEDGE_PREFIX.length) : path

export const normalizeWikiPath = (input: string) => {
  const trimmed = input.trim().replace(/^\/+/, '').replace(/^\.\//, '')
  return stripKnowledgePrefix(trimmed)
}

export const ensureMarkdownExtension = (path: string) => {
  if (path.toLowerCase().endsWith('.md')) return path
  return `${path}.md`
}

export const toKnowledgePath = (wikiPath: string) => {
  const normalized = normalizeWikiPath(wikiPath)
  if (!normalized || normalized.includes('..') || normalized.endsWith('/')) return null
  return `${KNOWLEDGE_PREFIX}${ensureMarkdownExtension(normalized)}`
}

export const wikiLabel = (wikiPath: string) => {
  const normalized = normalizeWikiPath(wikiPath)
  const name = normalized.split('/').pop() || normalized
  return name.replace(/\.md$/i, '')
}
