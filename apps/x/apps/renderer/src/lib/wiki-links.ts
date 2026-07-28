const KNOWLEDGE_PREFIX = 'knowledge/'

/**
 * Matches a `[[wiki link]]` token. Global, so callers get every occurrence.
 *
 * Shared between `.replace()` and `.matchAll()` call sites: `replace` resets
 * lastIndex and `matchAll` operates on a clone, so neither leaks position to
 * the other. A `.exec()`/`.test()` loop would — use a local copy for those.
 */
export const WIKI_LINK_TOKEN_REGEX = /\[\[([^[\]]+)\]\]/g

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

// ---------------------------------------------------------------------------
// Rename rewriting
//
// Moved verbatim from App.tsx. These deliberately do NOT reuse the helpers
// above: `stripKnowledgePrefixForWiki` normalizes separators and matches the
// prefix case-insensitively, where `stripKnowledgePrefix` is a plain
// case-sensitive slice. Folding them together would change behavior on
// Windows-style paths and on a `Knowledge/` prefix.
// ---------------------------------------------------------------------------

export const normalizeRelPathForWiki = (relPath: string) =>
  relPath.replace(/\\/g, '/').replace(/^\/+/, '')

export const stripKnowledgePrefixForWiki = (relPath: string) => {
  const normalized = normalizeRelPathForWiki(relPath)
  return normalized.toLowerCase().startsWith(KNOWLEDGE_PREFIX)
    ? normalized.slice(KNOWLEDGE_PREFIX.length)
    : normalized
}

export const stripMarkdownExtensionForWiki = (wikiPath: string) =>
  wikiPath.toLowerCase().endsWith('.md') ? wikiPath.slice(0, -3) : wikiPath

export const wikiPathCompareKey = (wikiPath: string) =>
  stripMarkdownExtensionForWiki(wikiPath).toLowerCase()

export const splitWikiPathPrefix = (rawPath: string) => {
  let normalized = rawPath.trim().replace(/^\/+/, '').replace(/^\.\//, '')
  const hadKnowledgePrefix = /^knowledge\//i.test(normalized)
  if (hadKnowledgePrefix) {
    normalized = normalized.slice(KNOWLEDGE_PREFIX.length)
  }
  return { pathWithoutPrefix: normalized, hadKnowledgePrefix }
}

/**
 * Rewrite every `[[wiki link]]` in `markdown` that pointed at `fromRelPath` so
 * it points at `toRelPath`. Preserves the original link's alias, anchor,
 * surrounding whitespace, `knowledge/` prefix, and `.md` extension.
 *
 * Both paths must be markdown files under knowledge/ — otherwise the markdown
 * is returned untouched.
 */
export const rewriteWikiLinksForRenamedFileInMarkdown = (
  markdown: string,
  fromRelPath: string,
  toRelPath: string
) => {
  const normalizedFrom = normalizeRelPathForWiki(fromRelPath)
  const normalizedTo = normalizeRelPathForWiki(toRelPath)
  const lowerFrom = normalizedFrom.toLowerCase()
  const lowerTo = normalizedTo.toLowerCase()
  if (!lowerFrom.startsWith(KNOWLEDGE_PREFIX) || !lowerFrom.endsWith('.md')) return markdown
  if (!lowerTo.startsWith(KNOWLEDGE_PREFIX) || !lowerTo.endsWith('.md')) return markdown

  const fromWikiPath = stripKnowledgePrefixForWiki(normalizedFrom)
  const toWikiPath = stripKnowledgePrefixForWiki(normalizedTo)
  const fromCompareKey = wikiPathCompareKey(fromWikiPath)
  const fromBaseName = stripMarkdownExtensionForWiki(fromWikiPath).split('/').pop()?.toLowerCase() ?? null
  const toWikiPathWithoutExtension = stripMarkdownExtensionForWiki(toWikiPath)
  const toBaseName = toWikiPathWithoutExtension.split('/').pop() ?? toWikiPathWithoutExtension

  return markdown.replace(WIKI_LINK_TOKEN_REGEX, (fullMatch, innerRaw: string) => {
    const pipeIndex = innerRaw.indexOf('|')
    const pathAndAnchor = pipeIndex >= 0 ? innerRaw.slice(0, pipeIndex) : innerRaw
    const aliasSuffix = pipeIndex >= 0 ? innerRaw.slice(pipeIndex) : ''

    const hashIndex = pathAndAnchor.indexOf('#')
    const pathPart = hashIndex >= 0 ? pathAndAnchor.slice(0, hashIndex) : pathAndAnchor
    const anchorSuffix = hashIndex >= 0 ? pathAndAnchor.slice(hashIndex) : ''

    const leadingWhitespace = pathPart.match(/^\s*/)?.[0] ?? ''
    const trailingWhitespace = pathPart.match(/\s*$/)?.[0] ?? ''
    const rawPath = pathPart.trim()
    if (!rawPath) return fullMatch

    const { pathWithoutPrefix, hadKnowledgePrefix } = splitWikiPathPrefix(rawPath)
    if (!pathWithoutPrefix) return fullMatch

    const matchesFullPath = wikiPathCompareKey(pathWithoutPrefix) === fromCompareKey
    const isBareTarget = !pathWithoutPrefix.includes('/')
    const targetBaseName = stripMarkdownExtensionForWiki(pathWithoutPrefix).toLowerCase()
    const matchesBareSelfName = Boolean(fromBaseName && isBareTarget && targetBaseName === fromBaseName)
    if (!matchesFullPath && !matchesBareSelfName) return fullMatch

    const preserveMarkdownExtension = rawPath.toLowerCase().endsWith('.md')
    const rewrittenTarget = matchesBareSelfName
      ? (preserveMarkdownExtension ? `${toBaseName}.md` : toBaseName)
      : (preserveMarkdownExtension ? toWikiPath : toWikiPathWithoutExtension)
    const finalPath = hadKnowledgePrefix ? `${KNOWLEDGE_PREFIX}${rewrittenTarget}` : rewrittenTarget

    return `[[${leadingWhitespace}${finalPath}${trailingWhitespace}${anchorSuffix}${aliasSuffix}]]`
  })
}
