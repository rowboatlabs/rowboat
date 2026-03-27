export const skill = String.raw`
# App Navigation Skill

You have access to the **app-navigation** tool which lets you control the Rowboat UI directly — opening notes, switching views, filtering the knowledge base, and creating saved views.

## Actions

### open-note
Open a specific knowledge file in the editor pane.

**When to use:** When the user asks to see, open, or view a specific note (e.g., "open John's note", "show me the Acme project page").

**Parameters:**
- ` + "`path`" + `: Full workspace-relative path (e.g., ` + "`knowledge/People/John Smith.md`" + `)

**Tips:**
- Use ` + "`workspace-grep`" + ` first to find the exact path if you're unsure of the filename.
- Always pass the full ` + "`knowledge/...`" + ` path, not just the filename.

### open-view
Switch the UI to the graph or bases view.

**When to use:** When the user asks to see the knowledge graph, view all notes, or open the bases/table view.

**Parameters:**
- ` + "`view`" + `: ` + "`\"graph\"`" + ` or ` + "`\"bases\"`" + `

### update-base-view
Change filters, columns, sort order, or search in the bases (table) view.

**When to use:** When the user asks to find, filter, sort, or search notes. Examples: "show me all active customers", "filter by topic=hiring", "sort by name", "search for pricing".

**Parameters:**
- ` + "`filters`" + `: Object with ` + "`set`" + `, ` + "`add`" + `, ` + "`remove`" + `, or ` + "`clear`" + ` — each takes an array of ` + "`{ category, value }`" + ` pairs.
  - ` + "`set`" + `: Replace ALL current filters with these.
  - ` + "`add`" + `: Append filters without removing existing ones.
  - ` + "`remove`" + `: Remove specific filters.
  - ` + "`clear: true`" + `: Remove all filters.
- ` + "`columns`" + `: Object with ` + "`set`" + `, ` + "`add`" + `, or ` + "`remove`" + ` — each takes an array of column names (frontmatter keys).
- ` + "`sort`" + `: ` + "`{ field, dir }`" + ` where dir is ` + "`\"asc\"`" + ` or ` + "`\"desc\"`" + `.
- ` + "`search`" + `: Free-text search string.

**Tips:**
- If unsure what categories/values are available, call ` + "`get-base-state`" + ` first.
- For "show me X", prefer ` + "`filters.set`" + ` to start fresh rather than ` + "`filters.add`" + `.
- Categories come from frontmatter keys (e.g., relationship, status, topic, type).
- **CRITICAL: Do NOT pass ` + "`columns`" + ` unless the user explicitly asks to show/hide specific columns.** Omit the ` + "`columns`" + ` parameter entirely when only filtering, sorting, or searching. Passing ` + "`columns`" + ` will override the user's current column layout and can make the view appear empty.

### get-base-state
Retrieve information about what's in the knowledge base — available filter categories, values, and note count.

**When to use:** When you need to know what properties exist before filtering, or when the user asks "what can I filter by?", "how many notes are there?", etc.

**Parameters:**
- ` + "`base_name`" + ` (optional): Name of a saved base to inspect.

### create-base
Save the current view configuration as a named base.

**When to use:** When the user asks to save a filtered view, create a saved search, or says "save this as [name]".

**Parameters:**
- ` + "`name`" + `: Human-readable name for the base.

## Workflow Example

1. User: "Show me all people who are customers"
2. First, check what properties are available:
   ` + "`app-navigation({ action: \"get-base-state\" })`" + `
3. Apply filters based on the available properties:
   ` + "`app-navigation({ action: \"update-base-view\", filters: { set: [{ category: \"relationship\", value: \"customer\" }] } })`" + `
4. If the user wants to save it:
   ` + "`app-navigation({ action: \"create-base\", name: \"Customers\" })`" + `

## Important Notes
- The ` + "`update-base-view`" + ` action will automatically navigate to the bases view if the user isn't already there.
- ` + "`open-note`" + ` validates that the file exists before navigating.
- Filter categories and values come from frontmatter in knowledge files.
- **Never send ` + "`columns`" + ` or ` + "`sort`" + ` with ` + "`update-base-view`" + ` unless the user specifically asks to change them.** Only pass the parameters you intend to change — omitted parameters are left untouched.
`;

export default skill;
