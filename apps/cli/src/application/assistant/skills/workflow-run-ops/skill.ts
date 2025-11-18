export const skill = String.raw`
# Agent Run Operations

Package of repeatable commands for running agents, inspecting agent run history under ~/.rowboat/runs, and managing cron schedules. Load this skill whenever a user asks about running agents, execution history, paused runs, or scheduling.

## When to use
- User wants to run an agent (including multi-agent workflows)
- User wants to list or filter agent runs (all runs, by agent, time range, or paused for input)
- User wants to inspect cron jobs or change agent schedules
- User asks how to set up monitoring for waiting runs

## Running Agents

**To run any agent**:
\`\`\`bash
rowboatx --agent <agent-name>
\`\`\`

**With input**:
\`\`\`bash
rowboatx --agent <agent-name> --input "your input here"
\`\`\`

**Non-interactive** (for automation/cron):
\`\`\`bash
rowboatx --agent <agent-name> --input "input" --no-interactive
\`\`\`

**Note**: Multi-agent workflows are just agents that have other agents in their tools. Run the orchestrator agent to trigger the whole workflow.

## Run monitoring examples
Operate from ~/.rowboat (Rowboat tools already set this as the working directory). Use executeCommand with the sample Bash snippets below, modifying placeholders as needed.

Each run file name starts with a timestamp like '2025-11-12T08-02-41Z'. You can use this to filter for date/time ranges.

Each line of the run file contains a running log with the first line containing information about the agent run. E.g. '{"type":"start","runId":"2025-11-12T08-02-41Z-0014322-000","agent":"agent_name","interactive":true,"ts":"2025-11-12T08:02:41.168Z"}'

If a run is waiting for human input the last line will contain 'paused_for_human_input'. See examples below.

1. **List all runs**
   
   ls ~/.rowboat/runs
   

2. **Filter by agent**
   
   grep -rl '"agent":"<agent-name>"' ~/.rowboat/runs | xargs -n1 basename | sed 's/\.jsonl$//' | sort -r
   
   Replace <agent-name> with the desired agent name.

3. **Filter by time window**
   To the previous commands add the below through unix pipe
   
   awk -F'/' '$NF >= "2025-11-12T08-03" && $NF <= "2025-11-12T08-10"'
   
   Use the correct timestamps.

4. **Show runs waiting for human input**
   
   awk 'FNR==1{if (NR>1) print fn, last; fn=FILENAME} {last=$0} END{print fn, last}' ~/.rowboat/runs/*.jsonl | grep 'pause-for-human-input' | awk '{print $1}'
   
   Prints the files whose last line equals 'pause-for-human-input'.

## Cron management examples

For scheduling agents to run automatically at specific times.

1. **View current cron schedule**
   \`\`\`bash
   crontab -l 2>/dev/null || echo 'No crontab entries configured.'
   \`\`\`

2. **Schedule an agent to run periodically**
   \`\`\`bash
   (crontab -l 2>/dev/null; echo '0 10 * * * cd /path/to/cli && rowboatx --agent <agent-name> --input "input" --no-interactive >> ~/.rowboat/logs/<agent-name>.log 2>&1') | crontab -
   \`\`\`
   
   Example (runs daily at 10 AM):
   \`\`\`bash
   (crontab -l 2>/dev/null; echo '0 10 * * * cd ~/rowboat-V2/apps/cli && rowboatx --agent podcast_workflow --no-interactive >> ~/.rowboat/logs/podcast.log 2>&1') | crontab -
   \`\`\`

3. **Unschedule/remove an agent**
   \`\`\`bash
   crontab -l | grep -v '<agent-name>' | crontab -
   \`\`\`

## Common cron schedule patterns
- \`0 10 * * *\` - Daily at 10 AM
- \`0 */6 * * *\` - Every 6 hours
- \`0 9 * * 1\` - Every Monday at 9 AM
- \`*/30 * * * *\` - Every 30 minutes
`;

export default skill;
