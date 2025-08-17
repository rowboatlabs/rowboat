export const EXAMPLE_6_MEETING_PREP_PIPELINE = `
### Example 6: Automated Meeting Prep Pipeline

**User Request:**
I want to automate my meeting preparation. Can you build a workflow that, for every new calendar invite, researches the attendees, compiles a summary, and posts it to our #meeting-prep Slack channel?

**Copilot Response:**

Yes, I can build that for you. This is a perfect use case for a multi-step pipeline.

I'll create a workflow with a Hub agent that triggers a three-step pipeline:

Research Participants: Looks up each person in the invite.

Compile Summary: Consolidates the research into a clean summary.

Send to Slack: Posts the final summary to the #meeting-prep channel.

Here is the full setup.

---

### 1. Add Required Tools

First, I'll add the necessary tools for web research (Firecrawl) and sending Slack messages.

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

Now, I'll create the three agents that will execute each step of the pipeline.

#### a. Research Participants

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Research Participants
{
  "change_description": "Create a pipeline agent to research each meeting participant using Firecrawl.",
  "config_changes": {
    "name": "Research Participants",
    "type": "pipeline",
    "description": "Researches each participant using Firecrawl and returns a summary for each.",
    "instructions": "1. Extract the names of the participants from the calendar invite \\n2. Do a search using [@tool:Search](#mention) for each of them",
    "model": "{agent_model}",
    "outputVisibility": "internal",
    "controlType": "relinquish_to_parent"
  }
}
\`\`\`

#### b. Compile Summary

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Compile Summary
{
  "change_description": "Create a pipeline agent to compile participant research into a single summary.",
  "config_changes": {
    "name": "Compile Summary",
    "type": "pipeline",
    "description": "Compiles a meeting prep summary from participant research results.",
    "instructions": "Summarize the participant research into one paragraph each.",
    "model": "{agent_model}",
    "outputVisibility": "internal",
    "controlType": "relinquish_to_parent"
  }
}
\`\`\`

#### c. Send to Slack

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Send to Slack
{
  "change_description": "Create a pipeline agent to send the final summary to the #meeting-prep channel.",
  "config_changes": {
    "name": "Send to Slack",
    "type": "pipeline",
    "description": "Sends the compiled meeting prep summary to the Slack channel meeting-prep.",
    "instructions": "Send this to slack channel #meeting-prep using [@tool:Send message](#mention)",
    "model": "{agent_model}",
    "outputVisibility": "internal",
    "controlType": "relinquish_to_parent"
  }
}
\`\`\`

---

### 3. Create the Pipeline Definition

Next, I'll define the pipeline to run these agents in the correct order.

\`\`\`copilot_change
// action: create_new
// config_type: pipeline
// name: Meeting Prep Pipeline
{
  "change_description": "Create an ordered pipeline: research -> compile -> send to Slack.",
  "config_changes": {
    "name": "Meeting Prep Pipeline",
    "description": "Pipeline for meeting prep: research participants, compile summary, send to Slack.",
    "agents": [
      "Research Participants",
      "Compile Summary",
      "Send to Slack"
    ]
  }
}
\`\`\`

---

### 4. Create the Hub Agent

Finally, I'll create the user-facing Hub agent that will be triggered by your calendar events.

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Meeting Prep Hub
{
  "change_description": "Create a user-facing hub to trigger the meeting prep pipeline.",
  "config_changes": {
    "name": "Meeting Prep Hub",
    "type": "conversation",
    "description": "Hub agent to orchestrate the meeting prep pipeline for every calendar invite.",
    "instructions": "Call the Meeting Prep Pipeline.",
    "model": "{agent_model}",
    "outputVisibility": "user_facing",
    "controlType": "retain"
  }
}
\`\`\`

This workflow is now ready. Once you apply the changes, it will automatically handle your meeting prep based on new calendar invites.
`;