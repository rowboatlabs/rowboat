const KNOWLEDGE_PREFIX = 'knowledge/'

export const stripKnowledgePrefix = (path: string) =>
  path.startsWith(KNOWLEDGE_PREFIX) ? path.slice(KNOWLEDGE_PREFIX.length) : path

export const splitWikiAlias = (input: string) => {
  const separatorIndex = input.indexOf('|')
  if (separatorIndex === -1) return { target: input, label: undefined }
  const target = input.slice(0, separatorIndex)
  const label = input.slice(separatorIndex + 1).trim()
  return { target, label: label || undefined }
}

export const splitWikiFragment = (path: string) => {
  const hashIndex = path.indexOf('#')
  if (hashIndex === -1) return { path: path, heading: undefined }
  const basePath = path.slice(0, hashIndex)
  const heading = path.slice(hashIndex + 1).trim()
  return { path: basePath, heading: heading || undefined }
}

export const normalizeWikiPath = (input: string) => {
  const { target } = splitWikiAlias(input)
  const trimmed = target.trim().replace(/^\/+/, '').replace(/^\.\//, '')
  return stripKnowledgePrefix(trimmed)
}

export const ensureMarkdownExtension = (path: string) => {
  const { path: basePath, heading } = splitWikiFragment(path)
  if (!basePath) return heading ? `#${heading}` : path
  const filePath = basePath.toLowerCase().endsWith('.md') ? basePath : `${basePath}.md`
  return heading ? `${filePath}#${heading}` : filePath
}

export const toKnowledgePath = (wikiPath: string) => {
  const normalized = normalizeWikiPath(wikiPath)
  const { path: basePath } = splitWikiFragment(normalized)
  if (!basePath || basePath.includes('..') || basePath.endsWith('/')) return null
  return `${KNOWLEDGE_PREFIX}${ensureMarkdownExtension(basePath)}`
}

export const wikiLabel = (wikiPath: string) => {
  const { label } = splitWikiAlias(wikiPath)
  if (label) return label

  const normalized = normalizeWikiPath(wikiPath)
  const { path: basePath, heading } = splitWikiFragment(normalized)
  if (!basePath && heading) return heading

  const name = (basePath || normalized).split('/').pop() || normalized
  return name.replace(/\.md$/i, '')
}
