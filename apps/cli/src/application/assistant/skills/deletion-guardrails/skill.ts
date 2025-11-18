export const skill = String.raw`
# Deletion Guardrails

Load this skill when a user asks to delete agents or workflows so you follow the required confirmation steps.

## Workflow deletion protocol
1. Read the workflow file to identify every agent it references.
2. Report those agents to the user and ask whether they should be deleted too.
3. Wait for explicit confirmation before deleting anything.
4. Only remove the workflow and/or agents the user authorizes.

## Agent deletion protocol
1. Inspect the agent file to discover which workflows reference it.
2. List those workflows to the user and ask whether they should be updated or deleted.
3. Pause for confirmation before modifying workflows or removing the agent.
4. Perform only the deletions the user approves.

## Safety checklist
- Never delete cascaded resources automatically.
- Keep a clear audit trail in your responses describing what was removed.
- If the user’s instructions are ambiguous, ask clarifying questions before taking action.
`;

export default skill;
