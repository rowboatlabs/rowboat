/**
 * Frontmatter parsing utilities for knowledge base markdown files.
 * Used by core (get-base-state) to scan knowledge files for available properties.
 */

/**
 * Parse a markdown file's YAML frontmatter into key-value pairs.
 * Handles both scalar values (`key: value`) and list values (`key:\n  - item`).
 * Returns `{ fields, body }` where fields maps keys to string or string[].
 */
export function parseFrontmatter(content: string): { fields: Record<string, string | string[]>; body: string } {
  if (!content.startsWith('---')) {
    return { fields: {}, body: content };
  }
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { fields: {}, body: content };
  }

  const rawBlock = content.slice(4, endIndex); // skip opening '---\n'
  const body = content.slice(endIndex + 4).replace(/^\n/, '');
  const fields: Record<string, string | string[]> = {};
  let currentKey: string | null = null;

  for (const line of rawBlock.split('\n')) {
    if (line.trim() === '' || line === '---') {
      currentKey = null;
      continue;
    }

    // Top-level key: value
    const topMatch = line.match(/^(\w[\w\s]*\w|\w+):\s*(.*)$/);
    if (topMatch) {
      const key = topMatch[1];
      const value = topMatch[2].trim();
      if (value) {
        fields[key] = value;
        currentKey = null;
      } else {
        // List will follow
        currentKey = key;
        fields[key] = [];
      }
      continue;
    }

    // List item under current key
    if (currentKey) {
      const itemMatch = line.match(/^\s+-\s+(.+)$/);
      if (itemMatch) {
        const arr = fields[currentKey];
        if (Array.isArray(arr)) {
          arr.push(itemMatch[1].trim());
        }
      }
    }
  }

  return { fields, body };
}
