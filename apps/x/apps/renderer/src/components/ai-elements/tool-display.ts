export type ToolDisplay = {
  title: string
  subtitle?: string
}

const SPECIAL_TITLES: Record<string, string> = {
  loadSkill: 'Understanding MCP tools',
  listMcpServers: 'Listing MCP servers',
  listMcpTools: 'Listing MCP tools',
  listMcpResources: 'Listing MCP resources',
  listMcpResourceTemplates: 'Listing MCP resource templates',
  readMcpResource: 'Reading MCP resource',
}

function toWords(name: string): string[] {
  if (!name) return []

  // Split on separators first (workspace:readFile, runs:list, etc.)
  const normalized = name
    .replace(/[:/_.-]+/g, ' ')
    .trim()

  const parts: string[] = []
  for (const token of normalized.split(/\s+/)) {
    // Split camelCase/PascalCase within each token
    const camel = token
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    parts.push(...camel.split(/\s+/).filter(Boolean))
  }

  return parts
}

function titleCase(words: string[]): string {
  const acronyms = new Set(['mcp', 'url', 'id', 'api', 'ipc', 'json'])
  return words
    .map((w) => {
      const lower = w.toLowerCase()
      if (acronyms.has(lower)) return lower.toUpperCase()
      if (w.length <= 1) return w.toUpperCase()
      return w[0].toUpperCase() + w.slice(1)
    })
    .join(' ')
}

function verbToGerund(verb: string): string {
  const lower = verb.toLowerCase()
  const irregular: Record<string, string> = {
    run: 'Running',
    get: 'Getting',
    set: 'Setting',
    list: 'Listing',
    load: 'Loading',
    read: 'Reading',
    write: 'Writing',
    create: 'Creating',
    update: 'Updating',
    delete: 'Deleting',
    remove: 'Removing',
    rename: 'Renaming',
    open: 'Opening',
    close: 'Closing',
    toggle: 'Toggling',
    fetch: 'Fetching',
    search: 'Searching',
    provide: 'Providing',
  }
  if (irregular[lower]) return irregular[lower]
  return titleCase([lower + 'ing'])
}

export function getToolDisplay(name: string): ToolDisplay {
  const special = SPECIAL_TITLES[name]
  if (special) return { title: special, subtitle: name }

  const words = toWords(name)
  if (words.length === 0) return { title: 'Tool', subtitle: name }

  const [first, ...rest] = words
  const title =
    rest.length > 0
      ? `${verbToGerund(first)} ${titleCase(rest).replace(/\s+/g, ' ')}`
      : titleCase(words)

  return { title, subtitle: name }
}

export function getToolGroupTitle(toolNames: string[]): string {
  const joined = toolNames.join(' ')
  if (/mcp/i.test(joined)) return 'MCP activity'
  if (toolNames.some((n) => /search/i.test(n))) return 'Search activity'
  return 'Tool activity'
}

