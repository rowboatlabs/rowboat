export const EXAMPLE_1_MEETING_ASSISTANT = `
### Example 1: Meeting Assistant with Multi-Agent System

**User Request:**
Build me an assistant that can view my meetings on google calendar for a mentioned time period, do research on the participants and then give me a summary of the meeting sent to my email.

*call searchRelevantTools*
searchRelevantTools output:
<returns the tool data for Google Calendar, Tavily, and Gmail that can copy in your output when you need to add tools>

**Copilot Response:**

I'll break down your requirements into a multi-agent system and create the necessary agents and tools. Here's my plan:

**Plan & Agent Decomposition:**
1. Hub Agent: Orchestrates the workflow—asks for the time period, fetches meetings, and coordinates the process.
2. Meeting Fetch Agent: Gets meetings from Google Calendar for the specified time period.
3. Participant Research Agent: For each meeting, researches the participants using web search.
4. Meeting Summary Agent: Summarizes the meeting details and research.
5. Email Agent: Sends the summary to your email.

**Assumptions:**
- You want to specify the time period for meetings.
- You want research on all participants in each meeting.
- The summary should be sent to your email (which you'll provide).
- You want a single summary per meeting, sent as one email per meeting.

---

### 1. Add Required Tools

I'll add the suggested tools for Google Calendar, web search, and email:

\`\`\`copilot_change
// action: create_new
// config_type: tool
// name: Find event
{
  "change_description": "Added Google Calendar event finder tool for fetching meetings.",
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
// name: Tavily search
{
  "change_description": "Added Tavily web search tool for researching meeting participants.",
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
// name: Send Email
{
  "change_description": "Added Gmail send email tool for sending meeting summaries.",
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

### 2. Create Agents

#### a. Hub Agent (Meeting Assistant Hub)
I'll edit the Example Agent to become the hub agent:

\`\`\`copilot_change
// action: edit
// config_type: agent
// name: Example Agent
{
  "change_description": "Transformed Example Agent into the main hub agent orchestrating the meeting summary workflow.",
  "config_changes": {
    "name": "Meeting Assistant Hub",
    "type": "conversation",
    "description": "Hub agent to orchestrate meeting retrieval, participant research, summary generation, and email delivery.",
    "instructions": "## 🧑‍💼 Role:\\nYou are the hub agent responsible for orchestrating the process of viewing meetings, researching participants, summarizing meetings, and sending summaries via email.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Greet the user and ask for the time period for which they want to view meetings.\\n2. Ask for the user's email address to send the summary.\\n3. Call [@agent:Meeting Fetch Agent](#mention) with the specified time period.\\n4. For each meeting returned, call [@agent:Participant Research Agent](#mention) to research all participants.\\n5. For each meeting, call [@agent:Meeting Summary Agent](#mention) to generate a summary using meeting details and participant research.\\n6. For each summary, call [@agent:Email Agent](#mention) to send the summary to the user's email.\\n7. Inform the user when all summaries have been sent.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Orchestrating the workflow for meeting retrieval, research, summary, and email delivery.\\n\\n❌ Out of Scope:\\n- Directly fetching meetings, researching, summarizing, or sending emails (handled by sub-agents).\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Always confirm the time period and email address with the user.\\n- Ensure all steps are completed in sequence for each meeting.\\n\\n🚫 Don'ts:\\n- Do not perform research, summary, or email sending directly.\\n- Do not skip any step in the workflow.\\n- Do not mention internal agent names to the user.\\n- Do not say 'connecting you to another agent'.\\n- CRITICAL: Only transfer to one agent at a time and wait for its response before proceeding.",
    "examples": "- **User** : I want to see my meetings for next week and get summaries.\\n - **Agent response**: Sure! Please provide the start and end dates for the period you'd like to review.\\n\\n- **User** : From 2024-08-01 to 2024-08-07. My email is [USER_EMAIL]\\n - **Agent actions**: Call [@agent:Meeting Fetch Agent](#mention)\\n\\n- **Agent receives meetings** :\\n - **Agent actions**: For each meeting, call [@agent:Participant Research Agent](#mention)\\n\\n- **Agent receives participant research** :\\n - **Agent actions**: For each meeting, call [@agent:Meeting Summary Agent](#mention)\\n\\n- **Agent receives summary** :\\n - **Agent actions**: For each summary, call [@agent:Email Agent](#mention)\\n\\n- **Agent receives email confirmation** :\\n - **Agent response**: All meeting summaries have been sent to your email.",
    "model": "gpt-4.1",
    "outputVisibility": "user_facing",
    "controlType": "retain"
  }
}
\`\`\`

#### b. Meeting Fetch Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Meeting Fetch Agent
{
  "change_description": "Created agent to fetch meetings from Google Calendar for a specified time period.",
  "config_changes": {
    "name": "Meeting Fetch Agent",
    "type": "task",
    "description": "Fetches meetings from Google Calendar for a specified time period.",
    "instructions": "## 🧑‍💼 Role:\\nFetch meetings from the user's Google Calendar for the specified time period.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Receive the time period (start and end date/time) from the parent agent.\\n2. Use [@tool:Find event](#mention) to fetch all meetings in that period.\\n3. Return the list of meetings (with details: title, time, participants, description, etc.) to the parent agent.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Fetching meetings for a given time period.\\n\\n❌ Out of Scope:\\n- Researching participants.\\n- Summarizing meetings.\\n- Sending emails.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Return all relevant meeting details.\\n\\n🚫 Don'ts:\\n- Do not perform research or summaries.\\n- Do not interact with the user directly.",
    "examples": "- **Parent agent** : Fetch meetings from 2024-08-01 to 2024-08-07.\\n - **Agent actions**: Call [@tool:Find event](#mention)\\n - **Agent response**: [List of meetings with details]",
    "model": "gpt-4.1",
    "outputVisibility": "internal",
    "controlType": "relinquish_to_parent"
  }
}
\`\`\`

#### c. Participant Research Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Participant Research Agent
{
  "change_description": "Created agent to research meeting participants using web search.",
  "config_changes": {
    "name": "Participant Research Agent",
    "type": "task",
    "description": "Researches each meeting participant using web search.",
    "instructions": "## 🧑‍💼 Role:\\nResearch each participant in the meeting using web search and return a brief profile for each.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Receive a list of participant names and emails from the parent agent.\\n2. For each participant, use [@tool:Tavily search](#mention) to find relevant information.\\n3. Summarize the findings for each participant (role, company, notable info).\\n4. Return the research summaries to the parent agent.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Researching participants using web search.\\n\\n❌ Out of Scope:\\n- Fetching meetings.\\n- Summarizing meetings.\\n- Sending emails.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Provide concise, relevant participant profiles.\\n\\n🚫 Don'ts:\\n- Do not fabricate information.\\n- Do not interact with the user directly.",
    "examples": "- **Parent agent** : Research participants: [ATTENDEE_1_NAME] ([ATTENDEE_1_EMAIL]), [ATTENDEE_2_NAME] ([ATTENDEE_2_EMAIL])\\n - **Agent actions**: Call [@tool:Tavily search](#mention) for each participant\\n - **Agent response**: [ATTENDEE_1_NAME]: [summary], [ATTENDEE_2_NAME]: [summary]",
    "model": "gpt-4.1",
    "outputVisibility": "internal",
    "controlType": "relinquish_to_parent"
  }
}
\`\`\`

#### d. Meeting Summary Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Meeting Summary Agent
{
  "change_description": "Created agent to generate a summary of the meeting using meeting details and participant research.",
  "config_changes": {
    "name": "Meeting Summary Agent",
    "type": "task",
    "description": "Generates a summary of the meeting using meeting details and participant research.",
    "instructions": "## 🧑‍💼 Role:\\nGenerate a concise summary of the meeting, incorporating meeting details and participant research.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Receive meeting details and participant research from the parent agent.\\n2. Write a summary including:\\n   - Meeting title, date, and time\\n   - Purpose/agenda (if available)\\n   - Key participants and their profiles\\n   - Any notable context\\n3. Return the summary to the parent agent.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Summarizing meetings using provided details and research.\\n\\n❌ Out of Scope:\\n- Fetching meetings.\\n- Researching participants.\\n- Sending emails.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Be clear and concise.\\n- Highlight important details.\\n\\n🚫 Don'ts:\\n- Do not add information not provided.\\n- Do not interact with the user directly.",
    "examples": "- **Parent agent** : Summarize meeting: 'Q3 Planning', 2024-08-02 10:00, participants: [Alice summary, Bob summary]\\n - **Agent response**: Meeting: Q3 Planning (2024-08-02 10:00)\\nParticipants: [ATTENDEE_1_NAME] ([ATTENDEE_1_ROLE] at [COMPANY_1]), [ATTENDEE_2_NAME] ([ATTENDEE_2_ROLE] at [COMPANY_2])\\nSummary: The meeting will focus on Q3 product roadmap and resource allocation.",
    "model": "gpt-4.1",
    "outputVisibility": "internal",
    "controlType": "relinquish_to_parent"
  }
}
\`\`\`

#### e. Email Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Email Agent
{
  "change_description": "Created agent to send the meeting summary to the user's email.",
  "config_changes": {
    "name": "Email Agent",
    "type": "task",
    "description": "Sends the meeting summary to the user's email address.",
    "instructions": "## 🧑‍💼 Role:\\nSend the provided meeting summary to the user's email address.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Receive the meeting summary and recipient email from the parent agent.\\n2. Use [@tool:Send Email](#mention) to send the summary.\\n3. Confirm delivery to the parent agent.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Sending meeting summaries via email.\\n\\n❌ Out of Scope:\\n- Fetching meetings.\\n- Researching participants.\\n- Summarizing meetings.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Ensure the summary is sent to the correct email.\\n\\n🚫 Don'ts:\\n- Do not interact with the user directly.",
    "examples": "- **Parent agent** : Send summary to [USER_EMAIL]: [summary text]\\n - **Agent actions**: Call [@tool:Send Email](#mention)\\n - **Agent response**: Email sent confirmation.",
    "model": "gpt-4.1",
    "outputVisibility": "internal",
    "controlType": "relinquish_to_parent"
  }
}
\`\`\`

---

Once you review and apply the changes, you can try out a basic chat first. I can then help you better configure each agent or adjust the workflow as needed. Would you like to customize any step or add more details?
`;