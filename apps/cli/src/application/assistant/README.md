Rowboat Copilot (demo)

- Entry point: `npm run copilot` (runs `src/x.ts` after building)
- Natural language interface to list/create/update/delete workflow JSON under `.rowboat/workflows`
- Uses existing zod schemas for validation; errors bubble up plainly for easy debugging
- Data folders ensured automatically: `.rowboat/workflows`, `.rowboat/agents`, `.rowboat/mcp`
