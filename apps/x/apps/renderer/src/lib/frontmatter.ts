/**
 * Utilities for splitting, joining, and extracting tags from YAML frontmatter
 * in knowledge notes and email files.
 */

/** Split content into raw frontmatter block and body text. */
export function splitFrontmatter(content: string): { raw: string | null; body: string } {
  if (!content.startsWith('---')) {
    return { raw: null, body: content }
  }
  const endIndex = content.indexOf('\n---', 3)
  if (endIndex === -1) {
    return { raw: null, body: content }
  }
  // raw includes both delimiters and the trailing newline after closing ---
  const closingEnd = endIndex + 4 // '\n---' is 4 chars
  const raw = content.slice(0, closingEnd)
  // body starts after the closing --- and its trailing newline
  let body = content.slice(closingEnd)
  if (body.startsWith('\n')) {
    body = body.slice(1)
  }
  return { raw, body }
}

/** Re-prepend raw frontmatter before body when saving. */
export function joinFrontmatter(raw: string | null, body: string): string {
  if (!raw) return body
  return raw + '\n' + body
}

/**
 * Extract tags from raw frontmatter YAML.
 *
 * Handles two formats:
 * - Note format: `tags:` followed by `  - value` items
 * - Email format: `labels:` with nested keys (relationship, topics, type, filter, action)
 *   where values can be single strings or `  - value` arrays
 *
 * Skips metadata keys like `processed`, `labeled_at`, `tagged_at`.
 */
export function extractTags(raw: string | null): string[] {
  if (!raw) return []

  const lines = raw.split('\n')
  const tags: string[] = []

  let inTags = false
  let inLabels = false
  let inLabelSubKey = false

  const metadataKeys = new Set(['processed', 'labeled_at', 'tagged_at'])

  for (const line of lines) {
    // Top-level key detection
    if (/^\w/.test(line) || line === '---') {
      inTags = false
      inLabels = false
      inLabelSubKey = false
    }

    // Note format: tags:
    if (/^tags:\s*$/.test(line)) {
      inTags = true
      inLabels = false
      continue
    }

    // Email format: labels:
    if (/^labels:\s*$/.test(line)) {
      inLabels = true
      inTags = false
      continue
    }

    // Collect tag items under `tags:`
    if (inTags) {
      const match = line.match(/^\s+-\s+(.+)$/)
      if (match) {
        tags.push(match[1].trim())
      }
      continue
    }

    // Handle labels: nested structure
    if (inLabels) {
      // Sub-key like `  relationship:` or `  topics:`
      const subKeyMatch = line.match(/^\s{2}(\w+):\s*(.*)$/)
      if (subKeyMatch) {
        const key = subKeyMatch[1]
        const inlineValue = subKeyMatch[2].trim()
        if (metadataKeys.has(key)) {
          inLabelSubKey = false
          continue
        }
        if (inlineValue) {
          // Inline value like `  type: person`
          tags.push(inlineValue)
          inLabelSubKey = false
        } else {
          // Array follows
          inLabelSubKey = true
        }
        continue
      }

      // Array item under a sub-key like `    - value`
      if (inLabelSubKey) {
        const itemMatch = line.match(/^\s{4}-\s+(.+)$/)
        if (itemMatch) {
          tags.push(itemMatch[1].trim())
        }
      }
    }
  }

  return tags
}
