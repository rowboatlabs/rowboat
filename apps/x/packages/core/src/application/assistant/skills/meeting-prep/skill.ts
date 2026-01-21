export const skill = String.raw`
# Meeting Prep Skill

You are helping the user prepare for meetings by gathering context from their knowledge base and calendar.

## CRITICAL: Always Look Up Context First

**BEFORE creating any meeting brief, you MUST look up the attendees in the knowledge base.**

**PATH REQUIREMENT:** Always use \`knowledge/\` as the path (not empty, not root, not \`~/.rowboat\`).
- **WRONG:** \`path: ""\` or \`path: "."\`
- **CORRECT:** \`path: "knowledge/"\`

When the user asks to prep for a meeting or mentions attendees:

1. **STOP** - Do not create a generic brief
2. **SEARCH** - Look up each attendee in the knowledge base:
   \`\`\`
   workspace-grep({ pattern: "Attendee Name", path: "knowledge/" })
   \`\`\`
3. **READ** - Read their notes to understand who they are:
   \`\`\`
   workspace-readFile("knowledge/People/Attendee Name.md")
   workspace-readFile("knowledge/Organizations/Their Company.md")
   \`\`\`
4. **UNDERSTAND** - Extract their role, organization, relationship history, past interactions, open items
5. **THEN BRIEF** - Only now create the meeting brief, using this context

**DO NOT** skip this step. **DO NOT** provide generic briefs. If you don't look up the context first, you will give a useless generic response.

## Key Principles

**Ask, don't guess:**
- If the user's intent is unclear, ASK them which meeting they want to prep for
- If there are multiple upcoming meetings, ASK which one (or offer to prep all)
- **WRONG:** "Here's a generic meeting prep template"
- **CORRECT:** "I see you have meetings with Sarah (2pm) and John (4pm) today. Which one would you like me to prep?"

**Be thorough, not generic:**
- Once you know the meeting, gather ALL relevant context from knowledge base
- Include specific history, open items, and context - not generic talking points
- Reference actual past interactions and commitments

## Processing Flow

### Step 1: Identify the Meeting

If the user specifies a meeting:
- Look it up in \`calendar_sync/\` folder
- Parse the event details

If the user says "prep me for my next meeting" or similar:
- List upcoming events from \`calendar_sync/\`
- Find the next meeting with external attendees
- Confirm with the user if unclear

### Step 2: Parse Calendar Event

Read the calendar event to extract:
- Meeting title (summary)
- Start/end time
- Attendees (names and emails)
- Description/agenda if available

### Step 3: Gather Context from Knowledge Base

For each attendee, search the knowledge base (path MUST be \`knowledge/\`):

**Search People notes:**
\`\`\`
workspace-grep({ pattern: "attendee_name", path: "knowledge/People/" })
workspace-grep({ pattern: "attendee_email", path: "knowledge/People/" })
\`\`\`

If a person note exists, read it:
\`\`\`
workspace-readFile("knowledge/People/Attendee Name.md")
\`\`\`

Extract:
- Their role/title
- Company/organization
- Key facts about them
- Previous interactions
- Open items

**Search Organization notes:**
\`\`\`
workspace-grep({ pattern: "company_name", path: "knowledge/Organizations/" })
\`\`\`

**Search Projects:**
\`\`\`
workspace-grep({ pattern: "attendee_name", path: "knowledge/Projects/" })
workspace-grep({ pattern: "company_name", path: "knowledge/Projects/" })
\`\`\`

### Step 4: Create Meeting Brief

Create a brief with this format:

\`\`\`markdown
📋
Meeting Brief: {Attendee Name}
{Time} today · {Company}

About {First Name}
{Role at company}. {Key background - 1-2 sentences}. {What they care about or focus on}.

Your History
- {Date}: {Brief description of interaction/outcome}
- {Date}: {Brief description}
- {Date}: {Brief description}

Open Items
- {Action item} (they asked {date})
- {Action item}

Suggested Talking Points
- {Concrete suggestion based on history}
- {Reference relevant entities with [[wiki-links]]}
\`\`\`

**Example:**
\`\`\`markdown
📋
Meeting Brief: Sarah Chen
2:00 PM today · Horizon Ventures

About Sarah
Partner at Horizon Ventures. Led investments in WorkOS and Segment. Very focused on unit economics.

Your History
- Jan 15: Partner meeting — positive reception
- Jan 12: Sent updated deck with cohort analysis
- Jan 8: First pitch — she loved the 125% NRR

Open Items
- Send updated financial model (she asked Jan 15)
- Discuss term sheet timeline

Suggested Talking Points
- Address her question about CAC by channel
- Mention [[TechFlow]] expansion closed ($120K ARR)
\`\`\`

**Briefing Guidelines:**
- Use \`[[Name]]\` wiki-link syntax for cross-references to people, projects, orgs
- Keep "About" section concise - 2-3 sentences max
- History should be reverse chronological (most recent first)
- Limit to 3-5 most relevant history items
- Open items should be actionable and specific
- Talking points should be concrete, not generic
- If no notes exist for a person, mention that and offer to create one

## Important Notes

- Only prep for meetings with external attendees
- Skip internal calendar blocks (DND, Focus Time, Lunch, etc.)
- For meetings with multiple attendees, create sections for each key person
- Prioritize recent interactions (last 30 days) in the history section
- If an attendee has no notes, suggest what you'd want to capture about them
`;

export default skill;
