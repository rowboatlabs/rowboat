import { z } from 'zod';
import { stringify as stringifyYaml } from 'yaml';
import { BackgroundTaskSchema } from '@x/shared/dist/background-task.js';

const schemaYaml = stringifyYaml(z.toJSONSchema(BackgroundTaskSchema)).trimEnd();

export const skill = String.raw`
# Background Tasks Skill

A *background task* is a persistent agent the user configures once and the framework keeps firing — on a schedule, inside time-of-day windows, and/or in response to matching incoming events (Gmail threads, calendar changes). Each task lives at \`bg-tasks/<slug>/\` and owns two artifacts:

- \`task.yaml\` — the spec (the user's **instructions**, triggers, runtime state). You and the user both treat this as the source of truth.
- \`index.md\` — the agent-owned body. The runtime never writes here; the bg-task agent does, each run.

A task is one of two shapes — the agent decides per run from the verbs in \`instructions\`:

| Mode | Trigger verbs | Behavior |
|---|---|---|
| **OUTPUT** | "maintain / show / summarize / track / digest" | Rewrite \`index.md\` to reflect the current state. |
| **ACTION** | "send / draft / post / notify / file / reply / call" | Perform the action, then append a one-line journal entry under \`## Journal\` in \`index.md\`. |

Mixed instructions ("summarize and email it") trigger both.

## Tools you'll use (and ones you WON'T)

You have three dedicated builtin tools for this skill:

- \`create-background-task\` — materializes a new task on disk. **Use this. Do not write \`task.yaml\` yourself with \`file-editText\`, and do not search the codebase for IPC channels like \`bg-task:create\`** — they're renderer-side and not callable from here.
- \`patch-background-task\` — updates an existing task (instructions / triggers / active / model). Use this for the extend-don't-fork case.
- \`run-background-task-agent\` — manually fires a task to run now. Always call this immediately after \`create-background-task\` so the user sees content.

To inspect what tasks already exist, use \`file-glob\` on \`bg-tasks/*/task.yaml\` and \`file-readText\` on candidates. The user's bg-tasks folder is workspace-relative.

## Mode: act-first

Bg-task creation is **action-first**. Don't ask "should I?" — read the request, pick a name, call \`create-background-task\`, then call \`run-background-task-agent\` with the returned slug. Confirm in one line past-tense at the end. Tell the user the surface name: "Manage it from Background tasks in the sidebar."

The only exception: if a related bg-task already exists, **extend its instructions** via \`patch-background-task\` rather than creating a duplicate (see "Extend, don't fork").

## When you're loaded

The host's trigger paragraph loads this skill on:

- **Cadence**: "every morning", "daily", "hourly", "each Monday"
- **Watch/monitor**: "watch / monitor / keep an eye on / track / follow X"
- **Recurring artifact**: "morning briefing", "weekly review", "Acme deal dashboard"
- **Event-conditional**: "whenever a relevant email comes in, …"
- **Action verbs**: "draft / reply / call / post / notify / file / brief me on"
- **Decay questions**: "what's the weather", "top HN stories", "latest on X" — answer the one-off, then offer

If the user explicitly says "live note" / "live-note", the host loads the \`live-note\` skill instead — don't try to handle that case here.

## Workflow

1. **Check for existing tasks.** Before creating, glob \`bg-tasks/*/task.yaml\` and read any candidates whose intent might overlap with the user's ask. If a related task exists, jump to "Extend, don't fork" below.

2. **Pick a name.** Use a short, friendly title in title-case: "Morning weather", "Q3 deal digest", "HN top stories". The framework slugifies it (lowercase, dashes) for the folder — you don't manage the slug.

3. **Write the instructions.** Capture the user's intent in their own words, with concrete verbs. Bake any specifics (which source, which audience, output shape) into the instructions — the agent re-reads them on every run.

   - Good: *"Summarize my unread emails since yesterday 6pm into a one-paragraph digest plus a bulleted list of action items. Skip newsletters and automated notifications."*
   - Bad: *"Daily email summary."* (vague — agent will improvise unhelpfully)

4. **Pick triggers.** All three are independently optional; mix freely.

   - \`cronExpr\` — exact times. \`"0 7 * * *"\` = 7am daily.
   - \`windows\` — time-of-day bands. Each fires once per day inside the band, anywhere — forgiving when the app was offline.
   - \`eventMatchCriteria\` — a natural-language description of which incoming events should wake the task (e.g. "Emails about Q3 OKRs from the leadership team"). Pass-1 routing matches; the agent does Pass-2 before acting.

   No triggers at all = manual-only. The user clicks Run.

5. **Call \`create-background-task\`.** Required: \`name\`, \`instructions\`. Optional: \`triggers\`, \`model\`, \`provider\` (leave model/provider unset unless the user explicitly asked). The tool returns a slug.

6. **Call \`run-background-task-agent\`** with the slug. The agent runs once and populates \`index.md\`.

7. **Confirm.** One line. Name the task. Point at the sidebar. Done.

## Extend, don't fork

When the user's new ask overlaps with an existing task — e.g. they say "also include X" or the ask is a refinement of an existing task's intent — call \`patch-background-task\` instead of creating a duplicate.

Signals that you should extend:
- The user says "also …" / "and on top of that …" / "while you're at it …"
- The new ask is a refinement of an existing task's intent (different threshold, additional source, slightly different output)

When extending, pass the full rewritten \`instructions\` — don't try to surgical-edit a single sentence. The agent rereads instructions every run, so a clean rewrite is fine. After \`patch-background-task\` returns, call \`run-background-task-agent\` on the same slug so the user sees the updated output.

## Worked examples

### OUTPUT — morning briefing

User: *"Every morning at 7, give me a one-paragraph summary of overnight news in AI agents."*

1. \`create-background-task\` with:
   - \`name\`: "AI agent overnight news"
   - \`instructions\`: "Search the web and Hacker News for news about AI agents (autonomous LLM agents, agentic frameworks, agent benchmarks) published in the last 24 hours. Summarize the top developments in one paragraph (3-5 sentences) followed by a 3-5 item bulleted list of the most significant items with a single-sentence note each. Replace the body of index.md."
   - \`triggers\`: { \`cronExpr\`: "0 7 * * *" }
2. \`run-background-task-agent\` slug=ai-agent-overnight-news.
3. "Done — created the **AI agent overnight news** task. It'll run every morning at 7 and you can find it in Background tasks in the sidebar."

### ACTION — email auto-reply

User: *"Whenever I get an email about Q3 planning, draft a reply asking when they're free this week."*

1. \`create-background-task\` with:
   - \`name\`: "Q3 email auto-reply drafts"
   - \`instructions\`: "When an event arrives describing an email thread about Q3 planning, use the Gmail draft-create tool to draft a reply to the latest message asking the sender when they're free for a 30-minute call this week. Do not send the draft — leave it in Drafts for me to review. After drafting, append a journal entry to index.md noting the thread subject and the draft id."
   - \`triggers\`: { \`eventMatchCriteria\`: "Emails about Q3 planning (roadmap, OKRs, headcount, exec priorities)" }
2. \`run-background-task-agent\` slug=q3-email-auto-reply-drafts.
3. "Done — created the **Q3 email auto-reply drafts** task. It'll fire on relevant Gmail threads. Manage it from Background tasks in the sidebar."

### ACTION + journal — Slack watcher

User: *"Every weekday morning at 9, post a summary of unresolved high-priority issues to #engineering on Slack."*

1. \`create-background-task\` with:
   - \`name\`: "Daily eng triage"
   - \`instructions\`: "Each run, query <issue tracker> for unresolved issues labeled priority:high or above. Summarize counts by owner and the three oldest items. Send the summary to #engineering via the Slack tool. After sending, append a journal entry to index.md with the timestamp and the message id."
   - \`triggers\`: { \`cronExpr\`: "0 9 * * 1-5" }
2. \`run-background-task-agent\` slug=daily-eng-triage.

## Canonical Schema

\`\`\`yaml
${schemaYaml}
\`\`\`

Notes:
- \`active\` defaults to true. Patch \`{ active: false }\` to pause without deleting.
- \`createdAt\` and \`lastRun\` are runtime-managed — never write them yourself.
- The \`triggers\` block reuses Live Notes' \`Triggers\` schema verbatim. Cron grace and 5-minute backoff semantics are identical.

## Exceptions

The \`Background tasks\` sidebar view has a "New task" button that opens a form-driven flow. If the user is editing fields there or asking about a specific task from that view, *you* are not the right surface — the form is. Point at it ("You can also do this from the New task button in the Background tasks view") and step aside.
`;

export default skill;
