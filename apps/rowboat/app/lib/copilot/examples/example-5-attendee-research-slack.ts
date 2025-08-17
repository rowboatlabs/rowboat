export const EXAMPLE_5_ATTENDEE_RESEARCH_SLACK = `
### Example 5: Attendee Research & Slack Pipeline

**User Request:**
Build me an assistant that can do research on meeting attendees and send the findings to a Slack channel. And make sure it doesn't research me!

**Copilot Response:**

I can definitely build that. This will be a pipeline that first researches attendees and then sends the compiled summary to Slack.

To set this up correctly, I just need two pieces of information:

What is your email address (so I can exclude you from the research)?

What is the name of the Slack channel where you want the summary sent (e.g., general or meeting-prep)?

**User Response:**
My email is [USER_EMAIL] and the channel is [SLACK_CHANNEL].

**Copilot Response:**

Perfect. I'll set this up as a sequential pipeline with two main pipeline agents:

Step 1 (Research Agent) to look up each attendee.

Step 2 (Slack Send Agent) to post the summary.

Then I'll create a Pipeline Definition that runs these steps in order, and a Hub Agent to receive your requests and trigger the pipeline.

---

### 1. Add Required Tools

I'll add the necessary tools for web search and sending a Slack message.

\`\`\`copilot_change
// action: create_new
// config_type: tool
// name: Search
{
  "change_description": "Add Firecrawl tool to perform a web search and scrape content from the top results.",
  "config_changes": {
    "name": < get this from the searchRelevantTools output>,
    "description": < get this from the searchRelevantTools output>,
    "parameters": {
      "type": "object",
      "properties": < get this from the searchRelevantTools output>,
      "required": < get this from the searchRelevantTools output>
    },
    "isComposio": true,
    "composioData": {
      "slug": < get this from the searchRelevantTools output>,
      "noAuth": false,
      "toolkitName": < get this from the searchRelevantTools output>,
      "toolkitSlug": < get this from the searchRelevantTools output>,
      "logo": < get this from the searchRelevantTools output>
    }
  }
}
\`\`\`

\`\`\`copilot_change
// action: create_new
// config_type: tool
// name: Send message
{
  "change_description": "Add Slack tool to post a message to a channel.",
  "config_changes": {
    "name": < get this from the searchRelevantTools output>,
    "description": < get this from the searchRelevantTools output>,
    "parameters": {
      "type": "object",
      "properties": < get this from the searchRelevantTools output>,
      "required": < get this from the searchRelevantTools output>
    },
    "isComposio": true,
    "composioData": {
      "slug": < get this from the searchRelevantTools output>,
      "noAuth": false,
      "toolkitName": < get this from the searchRelevantTools output>,
      "toolkitSlug": < get this from the searchRelevantTools output>,
      "logo": < get this from the searchRelevantTools output>
    }
  }
}
\`\`\`

---

### 2. Create Pipeline Agents

#### a. Research Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Research Agent
{
  "change_description": "Create a pipeline agent to research attendees, excluding the user.",
  "config_changes": {
    "name": "Research Agent",
    "type": "pipeline",
    "description": "Internal agent that researches meeting attendees and returns a compiled summary.",
    "instructions": "## Role\\nYou are a pipeline agent that researches meeting attendees.\\n\\n---\\n## Task\\n1. You will receive attendee details from a previous step.\\n2. For each attendee, you **must** research them **one at a time** using the [@tool:Search](#mention). Do NOT research the user \`[USER_EMAIL]\`!\\n3. After all searches are complete, compile the findings into a single, plain text summary.\\n4. If no information is found for an attendee, state \"No public information found.\" for that person.\\n5. Return **only** the final compiled summary.\\n\\n---\\n## Constraint\\nDo **NOT** interact with users or send messages. Your only output is the final summary text.",
    "model": "{agent_model}",
    "outputVisibility": "internal",
    "controlType": "relinquish_to_parent"
  }
}
\`\`\`

#### b. Slack Send Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Slack Send Agent
{
  "change_description": "Create a pipeline agent to send the final summary to the specified Slack channel.",
  "config_changes": {
    "name": "Slack Send Agent",
    "type": "pipeline",
    "description": "Internal agent that sends the compiled research summary to a channel via Slack direct message and returns confirmation.",
    "instructions": "## Role\\nYou are a pipeline agent that sends a research summary to a Slack channel.\\n\\n---\\n## Task\\n1. You will receive a compiled text summary from the previous step.\\n2. Use the [@tool:Send message](#mention) tool to post this summary, using these parameters:\\n    * **channel**: \`[SLACK_CHANNEL]\`\\n    * **markdown_text**: Create a message starting with the subject \"*Meeting Attendee Research Summary*\", followed by the summary text you received.\\n3. Your job is complete after sending the message.\\n\\n---\\n## Constraint\\nDo **NOT** perform any action other than sending the Slack message as instructed.",
    "model": "{agent_model}",
    "outputVisibility": "internal",
    "controlType": "relinquish_to_parent"
  }
}
\`\`\`

---

### 3. Create the Pipeline Definition

\`\`\`copilot_change
// action: create_new
// config_type: pipeline
// name: Attendee Research & Slack Pipeline
{
  "change_description": "Create an ordered pipeline: research attendees -> send summary to Slack.",
  "config_changes": {
    "name": "Attendee Research & Slack Pipeline",
    "description": "Pipeline that researches meeting attendees and sends the compiled summary to a specified Slack channel.",
    "agents": [
      "Research Agent",
      "Slack Send Agent"
    ]
  }
}
\`\`\`

---

### 4. Create the Hub Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Meeting Research Hub
{
  "change_description": "Create a user-facing hub to trigger the research pipeline.",
  "config_changes": {
    "name": "Meeting Research Hub",
    "type": "conversation",
    "description": "Hub agent that receives meeting attendee details and triggers the research and Slack pipeline.",
    "instructions": "## Role\\nYou are a hub agent whose only job is to trigger a research pipeline.\\n\\n---\\n## Task\\n1.  When a user provides meeting attendee details, immediately call the [@pipeline:Attendee Research & Slack Pipeline](#mention).\\n2.  Once the pipeline is called, your task is complete. Respond with only the word: \`done!\`\\n\\n---\\n## Constraint\\nDo **NOT** perform any research or send messages. Your only function is to trigger the pipeline.",
    "model": "{agent_model}",
    "outputVisibility": "user_facing",
    "controlType": "retain"
  }
}
\`\`\`

All set! Once you apply these changes, you can start a chat and provide some attendee names to kick off the research.
`;