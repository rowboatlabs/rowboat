export const skill = String.raw`
# Workflow Run Operations

Package of repeatable commands for inspecting workflow run history under ~/.rowboat/runs and managing cron schedules that trigger Rowboat workflows. Load this skill whenever a user asks about workflow run files, paused executions, or cron-based scheduling/unscheduling.

## When to use
- User wants to list or filter workflow runs (all runs, by workflow, time range, or paused for input).
- User wants to inspect cron jobs or change the workflow schedule.
- User asks how to set up monitoring for waiting runs or confirm a cron entry exists.

## Run monitoring examples
Operate from ~/.rowboat (Rowboat tools already set this as the working directory). Use executeCommand with the sample Bash snippets below, modifying placeholders as needed.

Each run file name starts with a timestamp like '2025-11-12T08-02-41Z'. You can use this to filter for date/time ranges.

Each line of the run file contains a running log with the first line containing informatin of the workflow. E.g. '{"type":"start","runId":"2025-11-12T08-02-41Z-0014322-000","workflowId":"exa-search","workflow":{"name":"example_workflow","description":"An example workflow","steps":[{"type":"agent","id":"exa-search"}]},"interactive":true,"ts":"2025-11-12T08:02:41.168Z"}'

If a run is waiting for human input the last line will contain 'paused_for_human_input'. See examples below.

1. **List all runs**
   
   ls ~/.rowboat/runs
   

2. **Filter by workflow**
   
   grep -rl '"workflowId":"<workflow-id>"' ~/.rowboat/runs | xargs -n1 basename | sed 's/\.jsonl$//' | sort -r
   
   Replace <workflow-id> with the desired id.

3. **Filter by time window**
   To the previous commands add the below through unix pipe
   
   awk -F'/' '$NF >= "2025-11-12T08-03" && $NF <= "2025-11-12T08-10"'
   
   Use the correct timestamps.

4. **Show runs waiting for human input**
   
   awk 'FNR==1{if (NR>1) print fn, last; fn=FILENAME} {last=$0} END{print fn, last}' ~/.rowboat/runs/*.jsonl | grep 'pause-for-human-input' | awk '{print $1}'
   
   Prints the files whose last line equals 'pause-for-human-input'.

## Cron management examples
1. **View current cron schedule**
   
   bash -lc "crontab -l 2>/dev/null || echo 'No crontab entries configured for this user.'"
   
2. **Schedule a new workflow**
   
   crontab -l 2>/dev/null; echo '0 10 * * * /usr/local/bin/node dist/app.js exa-search "what is the weather in tokyo" >> /Users/arjun/.rowboat/logs/exa_search.log 2>&1' ) | crontab -
   

3. **Unschedule/remove a workflow**
   
   crontab -l | grep -v 'exa-search' | crontab -
   
   Removes cron lines containing the workflow id.
`;

export default skill;
