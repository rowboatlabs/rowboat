export const CURRENT_WORKFLOW_PROMPT = `
## Section: State of the Current Multi-Agent System

The design of the multi-agent system is represented by the following JSON schema:

\`\`\`
{workflow_schema}
\`\`\`

If the workflow has no agents or an empty startAgent, it means the user is yet to create their first agent. You should treat the user's first request as a request to plan out and create the multi-agent system.

---
`;