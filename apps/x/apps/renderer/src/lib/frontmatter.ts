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

/** Structured frontmatter fields extracted from categorized YAML. */
export type FrontmatterFields = {
  relationship: string | null
  relationship_sub: string[]
  topic: string[]
  email_type: string[]
  action: string[]
  status: string | null
  source: string[]
}

/**
 * Extract structured tag categories from raw frontmatter YAML.
 *
 * Handles both the new categorized format (top-level keys) and the legacy
 * flat `tags:` list. For legacy notes the flat tags are mapped into
 * categories using known tag values.
 */
export function extractFrontmatterFields(raw: string | null): FrontmatterFields {
  const fields: FrontmatterFields = {
    relationship: null,
    relationship_sub: [],
    topic: [],
    email_type: [],
    action: [],
    status: null,
    source: [],
  }
  if (!raw) return fields

  const lines = raw.split('\n')
  let currentKey: string | null = null

  for (const line of lines) {
    // Top-level key detection
    const topMatch = line.match(/^(\w+):\s*(.*)$/)
    if (topMatch || line === '---') {
      currentKey = null
    }

    if (topMatch) {
      const key = topMatch[1]
      const value = topMatch[2].trim()

      if (key in fields) {
        currentKey = key
        if (value) {
          const field = fields[key as keyof FrontmatterFields]
          if (Array.isArray(field)) {
            (field as string[]).push(value)
          } else {
            // single-value field
            ;(fields as Record<string, unknown>)[key] = value
          }
          currentKey = null // inline value, no list follows
        }
        continue
      }

      // Legacy flat tags: — parse and distribute into categories
      if (key === 'tags') {
        currentKey = '__legacy_tags'
        continue
      }
    }

    // List items under a categorized key
    if (currentKey && currentKey !== '__legacy_tags') {
      const itemMatch = line.match(/^\s+-\s+(.+)$/)
      if (itemMatch) {
        const value = itemMatch[1].trim()
        const field = fields[currentKey as keyof FrontmatterFields]
        if (Array.isArray(field)) {
          (field as string[]).push(value)
        } else {
          ;(fields as Record<string, unknown>)[currentKey] = value
        }
      }
      continue
    }

    // Legacy flat tag items → map into categories
    if (currentKey === '__legacy_tags') {
      const itemMatch = line.match(/^\s+-\s+(.+)$/)
      if (itemMatch) {
        const tag = itemMatch[1].trim()
        const cat = LEGACY_TAG_TO_CATEGORY[tag]
        if (cat) {
          const field = fields[cat as keyof FrontmatterFields]
          if (Array.isArray(field)) {
            (field as string[]).push(tag)
          } else if (!(fields as Record<string, unknown>)[cat]) {
            ;(fields as Record<string, unknown>)[cat] = tag
          }
        }
      }
      continue
    }
  }

  return fields
}

/**
 * Extract ALL top-level YAML key/value pairs from raw frontmatter.
 * Returns a flat record where scalar values are strings and list values are string[].
 * Skips `---` delimiters and blank lines.
 */
export function extractAllFrontmatterValues(raw: string | null): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  if (!raw) return result

  const lines = raw.split('\n')
  let currentKey: string | null = null

  for (const line of lines) {
    if (line === '---' || line.trim() === '') {
      currentKey = null
      continue
    }

    // Top-level key: value
    const topMatch = line.match(/^(\w[\w\s]*\w|\w+):\s*(.*)$/)
    if (topMatch) {
      const key = topMatch[1]
      const value = topMatch[2].trim()
      if (value) {
        result[key] = value
        currentKey = null
      } else {
        // List will follow
        currentKey = key
        result[key] = []
      }
      continue
    }

    // List item under current key
    if (currentKey) {
      const itemMatch = line.match(/^\s+-\s+(.+)$/)
      if (itemMatch) {
        const arr = result[currentKey]
        if (Array.isArray(arr)) {
          arr.push(itemMatch[1].trim())
        }
      }
    }
  }

  return result
}

/**
 * Convert a Record of frontmatter fields back to a raw YAML frontmatter string.
 * Returns null if no non-empty fields remain.
 */
export function buildFrontmatter(fields: Record<string, string | string[]>): string | null {
  const lines: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      lines.push(`${key}:`)
      for (const item of value) {
        if (item.trim()) lines.push(`  - ${item.trim()}`)
      }
    } else {
      const trimmed = (value ?? '').trim()
      if (!trimmed) continue
      lines.push(`${key}: ${trimmed}`)
    }
  }
  if (lines.length === 0) return null
  return `---\n${lines.join('\n')}\n---`
}

/** Map known tag values → category for legacy flat-list frontmatter. */
const LEGACY_TAG_TO_CATEGORY: Record<string, string> = {
  // relationship
  investor: 'relationship', customer: 'relationship', prospect: 'relationship',
  partner: 'relationship', vendor: 'relationship', product: 'relationship',
  candidate: 'relationship', team: 'relationship', advisor: 'relationship',
  personal: 'relationship', press: 'relationship', community: 'relationship',
  government: 'relationship',
  // relationship_sub
  primary: 'relationship_sub', secondary: 'relationship_sub',
  'executive-assistant': 'relationship_sub', cc: 'relationship_sub',
  'referred-by': 'relationship_sub', former: 'relationship_sub',
  champion: 'relationship_sub', blocker: 'relationship_sub',
  // topic
  sales: 'topic', support: 'topic', legal: 'topic', finance: 'topic',
  hiring: 'topic', fundraising: 'topic', travel: 'topic', event: 'topic',
  shopping: 'topic', health: 'topic', learning: 'topic', research: 'topic',
  // email_type
  intro: 'email_type', followup: 'email_type',
  // action
  'action-required': 'action', urgent: 'action', waiting: 'action',
  // status
  active: 'status', archived: 'status', stale: 'status',
  // source
  email: 'source', meeting: 'source', browser: 'source',
  'web-search': 'source', manual: 'source', import: 'source',
}

/** Tag category keys used in the categorized frontmatter format. */
const TAG_CATEGORY_KEYS = new Set([
  'relationship',
  'relationship_sub',
  'topic',
  'email_type',
  'action',
  'status',
  'source',
])

/** Keys that are metadata, not tags — skip when collecting tags. */
const METADATA_KEYS = new Set(['processed', 'labeled_at', 'tagged_at'])

/**
 * Extract tags from raw frontmatter YAML.
 *
 * Handles three formats:
 * - Legacy flat list: `tags:` followed by `  - value` items
 * - Categorized format: top-level keys like `relationship: customer` or
 *   `topic:` followed by `  - value` list items
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
  let inCategoryList = false

  for (const line of lines) {
    // Top-level key detection — resets all nested state
    if (/^\w/.test(line) || line === '---') {
      inTags = false
      inLabels = false
      inLabelSubKey = false
      inCategoryList = false
    }

    // Legacy note format: tags:
    if (/^tags:\s*$/.test(line)) {
      inTags = true
      inLabels = false
      inCategoryList = false
      continue
    }

    // Email format: labels:
    if (/^labels:\s*$/.test(line)) {
      inLabels = true
      inTags = false
      inCategoryList = false
      continue
    }

    // Categorized format: top-level tag category key
    const topKeyMatch = line.match(/^(\w+):\s*(.*)$/)
    if (topKeyMatch) {
      const key = topKeyMatch[1]
      const inlineValue = topKeyMatch[2].trim()

      if (TAG_CATEGORY_KEYS.has(key)) {
        if (inlineValue) {
          // Single value: `relationship: customer`
          tags.push(inlineValue)
          inCategoryList = false
        } else {
          // List follows: `topic:\n  - sales`
          inCategoryList = true
        }
        continue
      }
    }

    // Collect tag items under `tags:`
    if (inTags) {
      const match = line.match(/^\s+-\s+(.+)$/)
      if (match) {
        tags.push(match[1].trim())
      }
      continue
    }

    // Collect list items under a category key
    if (inCategoryList) {
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
        if (METADATA_KEYS.has(key)) {
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
