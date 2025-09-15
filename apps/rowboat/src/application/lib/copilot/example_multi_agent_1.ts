export const COPILOT_MULTI_AGENT_EXAMPLE_1 = `
## Examples

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
I'll create the hub agent:

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Meeting Assistant Hub
{
  "change_description": "Created the main hub agent orchestrating the meeting summary workflow.",
  "config_changes": {
    "name": "Meeting Assistant Hub",
    "type": "conversation",
    "description": "Hub agent to orchestrate meeting retrieval, participant research, summary generation, and email delivery.",
    "instructions": "## 🧑‍💼 Role:\\nYou are the hub agent responsible for orchestrating the process of viewing meetings, researching participants, summarizing meetings, and sending summaries via email.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Greet the user and ask for the time period for which they want to view meetings.\\n2. Ask for the user's email address to send the summary.\\n3. Call [@agent:Meeting Fetch Agent](#mention) with the specified time period.\\n4. For each meeting returned, call [@agent:Participant Research Agent](#mention) to research all participants.\\n5. For each meeting, call [@agent:Meeting Summary Agent](#mention) to generate a summary using meeting details and participant research.\\n6. For each summary, call [@agent:Email Agent](#mention) to send the summary to the user's email.\\n7. Inform the user when all summaries have been sent.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Orchestrating the workflow for meeting retrieval, research, summary, and email delivery.\\n\\n❌ Out of Scope:\\n- Directly fetching meetings, researching, summarizing, or sending emails (handled by sub-agents).\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Always confirm the time period and email address with the user.\\n- Ensure all steps are completed in sequence for each meeting.\\n\\n🚫 Don'ts:\\n- Do not perform research, summary, or email sending directly.\\n- Do not skip any step in the workflow.\\n- Do not mention internal agent names to the user.\\n- Do not say 'connecting you to another agent'.\\n- CRITICAL: Only transfer to one agent at a time and wait for its response before proceeding.",
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
    "model": "gpt-4.1",
    "outputVisibility": "internal",
    "controlType": "relinquish_to_parent"
  }
}
\`\`\`

---

### 6. Set the Start Agent

\`\`\`copilot_change
// action: edit
// config_type: start_agent
// name: Meeting Assistant Hub
{
  "change_description": "Set the Meeting Assistant Hub as the start agent for the workflow.",
  "config_changes": {}
}
\`\`\`

---

Once you review and apply the changes, you can try out a basic chat first. I can then help you better configure each agent or adjust the workflow as needed. Would you like to customize any step or add more details?

---

### Example 2: Google Doc Q&A Assistant

**User Request:**
Build me an assistant that looks at a google doc and answers users questions

*call searchRelevantTools*
searchRelevantTools output:
<returns the tool data for Google Docs that can copy in your output when you need to add tools>

**Copilot Response:**

I'll make the following changes to your workflow:

1. Add the "Get document by id" tool for retrieving the content of a Google Doc.
2. Replace the Example Agent with a single user-facing agent that:
   * Asks the user for the Google Doc ID and their question.
   * Uses the tool to fetch the document content.
   * Answers the user's question based only on the content of the fetched Google Doc (no RAG or external search).
   * Does not answer questions outside the content of the provided Google Doc.

Here are the changes:

I'm adding the "Get document by id" tool to fetch the content of a Google Doc by its ID:

\`\`\`copilot_change
// action: create_new
// config_type: tool
// name: Get document by id
{
  "change_description": "Added the 'Get document by id' tool to fetch the content of a Google Doc by its ID.",
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

I'm creating a user-facing agent that fetches a Google Doc by ID and answers questions based on its content:

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Google Doc QnA Assistant
{
  "change_description": "Created a user-facing agent that fetches a Google Doc by ID and answers user questions based only on its content.",
  "config_changes": {
    "name": "Google Doc QnA Assistant",
    "type": "conversation",
    "description": "Answers user questions based solely on the content of a specified Google Doc.",
    "instructions": "## 🧑‍💼 Role:\\nYou are an assistant that answers user questions using only the content of a specified Google Doc.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Ask the user for the Google Doc ID and their question.\\n2. Use the [@tool:Get document by id](#mention) tool to fetch the document content.\\n3. Read the content of the document.\\n4. Answer the user's question using only the information found in the document. If the answer is not present in the document, politely inform the user that the information is not available.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Answering questions strictly based on the content of the provided Google Doc.\\n\\n❌ Out of Scope:\\n- Answering questions not related to the content of the provided Google Doc.\\n- Using external sources or prior knowledge.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Always fetch the document before answering.\\n- Be concise and accurate.\\n- If the answer is not in the document, say so politely.\\n\\n🚫 Don'ts:\\n- Do not use information outside the document.\\n- Do not attempt to answer unrelated questions.\\n- Do not use RAG or external search.\\n",
    "model": "gpt-4.1",
    "outputVisibility": "user_facing",
    "controlType": "retain"
  }
}
\`\`\`

\`\`\`copilot_change
// action: edit
// config_type: start_agent
// name: Google Doc QnA Assistant
{
  "change_description": "Set the Google Doc QnA Assistant as the start agent for the workflow.",
  "config_changes": {}
}
\`\`\`

Once you review and apply the changes, you can try out a basic chat by providing a Google Doc ID and a question. I can then help you further refine the assistant if needed.

---

### Example 3: Tool Addition for LinkedIn and GitHub

**User Request:**
I want you to add tools that can be used to scrape a given linkedin URL, list users git hub repos, create a new github repo, and create or edit a file in that repository. Will make the agents later on

*call searchRelevantTools*
searchRelevantTools output:
<returns the tool data for Apify and Github that can copy in your output when you need to add tools>

**Copilot Response:**

I'll add the following tools to your workflow, matching your requirements:

1. Scrape public LinkedIn profile details from a given URL (using Apify actor runner)
2. List authenticated user's GitHub repositories
3. Create a new GitHub repository for the authenticated user
4. Create or update a text file in a GitHub repository for the authenticated user

Here are the tool additions:

\`\`\`copilot_change
// action: create_new
// config_type: tool
// name: Run Actor Sync & Get Dataset Items
{
  "change_description": "Add Apify tool to scrape public LinkedIn profile details from a given URL using an actor.",
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
// name: List repositories for the authenticated user
{
  "change_description": "Add GitHub tool to list repositories for the authenticated user.",
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
// name: Create a repository for the authenticated user
{
  "change_description": "Add GitHub tool to create a new repository for the authenticated user.",
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
// name: Create or update file contents
{
  "change_description": "Add GitHub tool to create or update a text file in a repository for the authenticated user.",
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

Once you review and apply these changes, all four tools will be available in your workflow. If you need help connecting these tools to agents or building a workflow around them, let me know!

---

### Example 4: Welcome Email Pipeline

**User Request:**
Create a pipeline that reads names + emails from a Google Sheet, personalizes a "welcome" email for each, and sends them via Gmail. The hub should just call the pipeline and report when done.

*call searchRelevantTools*
searchRelevantTools output:
<returns the tool data for Google Sheets "batch get" and Gmail "send email" that you can copy into your tool additions>

**Copilot Response:**

I'll set this up as a sequential pipeline with three pipeline agents:

1. **Step 1 (Fetch rows from Google Sheets)**
2. **Step 2 (Personalize email objects)**
3. **Step 3 (Send emails via Gmail)**

Then I'll create a **Pipeline Definition** that runs these steps in order, and update the Hub to call the pipeline and stop when it returns.

---

### 1. Add Required Tools

I'll add the suggested tools for Google Sheets and Gmail:

\`\`\`copilot_change
// action: create_new
// config_type: tool
// name: Batch get spreadsheet
{
  "change_description": "Add Google Sheets tool to read ranges from a spreadsheet.",
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
  "change_description": "Add Gmail tool to send emails (supports html + attachments).",
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

#### a. Pipeline Step 1 – Fetch rows from Sheets

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Pipeline Step 1 - Fetch Sheet Rows
{
  "change_description": "Create pipeline agent to fetch rows from Google Sheets.",
  "config_changes": {
    "name": "Pipeline Step 1 - Fetch Sheet Rows",
    "type": "pipeline",
    "description": "Reads rows (name, email) from a specified Google Sheet range.",
    "instructions": "## 🧑‍💼 Role:\\nFetch all requested rows from the provided Google Sheet and ranges.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Use [@tool:Batch get spreadsheet](#mention) with the given spreadsheet_id and ranges (e.g., A2:B).\\n2. Return a normalized array of { name, email } objects.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Fetching rows from Google Sheets and returning structured data.\\n\\n❌ Out of Scope:\\n- Personalization or sending emails.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Validate rows and skip empties.\\n🚫 Don'ts:\\n- Do not modify or send emails.",
    "model": "{agent_model}",
    "outputVisibility": "internal",
    "controlType": "relinquish_to_parent"
  }
}
\`\`\`

#### b. Pipeline Step 2 – Personalize emails

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Pipeline Step 2 - Personalize Emails
{
  "change_description": "Create pipeline agent to build personalized email payloads.",
  "config_changes": {
    "name": "Pipeline Step 2 - Personalize Emails",
    "type": "pipeline",
    "description": "Generates {to, subject, body} for each contact.",
    "instructions": "## 🧑‍💼 Role:\\nCreate a personalized email for each { name, email }.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. For each input row, produce an email object with:\\n   - to: email\\n   - subject: \"Welcome to the Rowboat Community!\"\\n   - body: \"Hi <Name>,\\n\\nWelcome to the Rowboat community! We're excited to have you.\\n\\nCheers,\\nTeam Rowboat\"\\n2. If name is missing, infer from email local-part (dots/underscores/hyphens → spaces; title case).\\n3. Return the list of email objects.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Pure transformation into email objects.\\n\\n❌ Out of Scope:\\n- Fetching sheet rows or sending emails.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Ensure friendly tone and correct subject.\\n🚫 Don'ts:\\n- Do not send emails.",
    "model": "{agent_model}"
  }
}
\`\`\`

#### c. Pipeline Step 3 – Send via Gmail

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Pipeline Step 3 - Send Emails
{
  "change_description": "Create pipeline agent to send emails using Gmail.",
  "config_changes": {
    "name": "Pipeline Step 3 - Send Emails",
    "type": "pipeline",
    "description": "Sends each prepared email via the Gmail tool.",
    "instructions": "## 🧑‍💼 Role:\\nSend each composed email with the Gmail tool.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. For each email object, call [@tool:Send Email](#mention).\\n2. Collect per-email success/failure.\\n3. Return a summary: { sent: n, failed: m, failures: [...] }.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Sending emails and summarizing results.\\n\\n❌ Out of Scope:\\n- Reading sheets or composing content.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Be resilient (skip invalid emails; record errors).\\n🚫 Don'ts:\\n- Do not alter the provided subject/body.",
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
// name: Welcome Email Pipeline
{
  "change_description": "Create an ordered pipeline: fetch → personalize → send.",
  "config_changes": {
    "name": "Welcome Email Pipeline",
    "description": "Reads contacts from Sheets, personalizes welcome emails, and sends via Gmail.",
    "agents": [
      "Pipeline Step 1 - Fetch Sheet Rows",
      "Pipeline Step 2 - Personalize Emails",
      "Pipeline Step 3 - Send Emails"
    ]
  }
}
\`\`\`

---

### 4. Update the Hub Agent

\`\`\`copilot_change
// action: edit
// config_type: agent
// name: HUB
{
  "change_description": "Update hub to execute the pipeline and stop.",
  "config_changes": {
    "name": "HUB",
    "type": "conversation",
    "description": "User-facing hub that triggers the welcome email pipeline and reports completion.",
    "instructions": "You must organise and ensure the pipeline completes its job of fetching contacts, personalizing emails, and sending them. Call [@pipeline:Welcome Email Pipeline](#mention).\\n\\nWhen the pipeline returns, inform the user that the job is done and STOP!",
    "model": "{agent_model}",
    "outputVisibility": "user_facing",
    "controlType": "retain"
  }
}
\`\`\`

---

Once you review and apply these changes, run a quick chat with the Hub. I can tweak ranges, subjects, or the email copy if you want something more branded.

---

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

---

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

---

### Example 7: Setting the start agent

**User Request**
Can you set the start agent to the Meeting Prep Hub?

**Copilot Response**

Yes, I can set the start agent to the Meeting Prep Hub.

\`\`\`copilot_change

// action: edit
// config_type: start_agent
// name: Meeting Prep Hub
{
  "change_description": "Set the start agent to the Meeting Prep Hub.",
  "config_changes": {},
}
\`\`\`


---

### Example 8: Delete an agent

**User Request:**
Can you delete the Slack Send Agent?

**Copilot Response:**

Yes, I can delete the Slack Send Agent.

\`\`\`copilot_change
// action: delete
// config_type: agent
// name: Slack Send Agent
{
  "change_description": "Delete the Slack Send Agent.",
  "config_changes": {},
  }
}
\`\`\`

---

### Example 9: Delete a tool

**User Request:**
Can you delete the Search tool?

**Copilot Response:**

Yes, I can delete the Search tool.


\`\`\`copilot_change
// action: delete
// config_type: tool
// name: Search
{
  "change_description": "Delete the Search tool.",
  "config_changes": {},
}
\`\`\`

---

### Example 10: Delete a pipeline

**User Request:**
Can you delete the Meeting Prep Pipeline?

**Copilot Response:**

Yes, I can delete the Meeting Prep Pipeline.

\`\`\`copilot_change
// action: delete
// config_type: pipeline
// name: Meeting Prep Pipeline
{
  "change_description": "Delete the Meeting Prep Pipeline.",
  "config_changes": {},
}
\`\`\`

---

### Example 8: Delivery Status & Product Information Assistant

**User Request:**
Build an assistant to handle delivery status and product information questions. I'll connect my MCP for delivery status and will add data on product information.

**Copilot Response:**

I'll design a multi-agent system to handle both delivery status and product information questions. Here’s my plan:
Plan & Agent Decomposition:
1. Delivery Status Mocked Tool: A mocked tool to simulate checking delivery status.
2. Hub Agent (user-facing): Orchestrates the workflow, determines if the user’s question is about delivery status or product information, and routes the query accordingly.
3. Delivery Status Agent (internal): Handles delivery status queries using the mocked tool (you can connect a real MCP tool for this later).
4. Product Info Agent (internal): Handles product information queries using the RAG data source (to be added by you).

Next Steps:
- I’ll create the agents and set the Hub Agent as the start agent.
- Once you connect your MCP tool for delivery status and add your product info data source, I can help you attach them to the relevant agents.

---

### 1. Add Required Tools

I'll add a mocked tool for getting delivery status. You can connect a real MCP server for this later:

\`\`\`copilot_change
// action: create_new
// config_type: tool
// name: Find event
{
  "change_description": "Added mock delivery status tool for simulating delivery status checks.",
  "config_changes": {
    "name": "Mock Delivery Status",
    "description": "A mock tool to simulate checking delivery status.",
    "mockTool": true,
    "mockInstructions": "This tool simulates checking the delivery status of an order. It will always return a predefined delivery status message.",
    "parameters": {
      "type": "object",
      "properties": {
        "order_id": {
          "type": "string",
          "description": "The order ID to check the delivery status for."
        }
      },
      "required": [
        "order_id"
      ]
    }
  }
}
\`\`\`

---

### 2. Add Variables

I'm adding a variable for the Company name:

\`\`\`copilot_change
// action: create_new
// config_type: prompt
// name: Find event
{
  "change_description": "Added variable for the Company name.",
  "config_changes": {
    "name": "Company name",
    "type": "base_prompt",
    "prompt": "<needs to be added>"
  }
}
\`\`\`

I'm adding another variable for the assistant name:

\`\`\`copilot_change
// action: create_new
// config_type: prompt
// name: Find event
{
  "change_description": "Added variable for the Assistant name.",
  "config_changes": {
    "name": "Assistant name",
    "type": "base_prompt",
    "prompt": "<needs to be added>"
  }
 }
\`\`\`

--- 

### 3. Create Agents

#### a. Hub Agent (Meeting Assistant Hub)
I'll create the hub agent:

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Product & Delivery Assistant
{
  "change_description": "Created the hub agent.",
  "config_changes": {
    "name": "Product & Delivery Assistant",
 "type": "conversation",
 "description": "Hub agent to answer product information questions (using RAG) and delivery status questions.",
 "instructions": "## 🧑‍💼 Role:\nYou are the hub agent responsible for orchestrating responses to product information and delivery status questions.\n\n---\n## ⚙️ Steps to Follow:\n1. Greet the user and ask how you can help. Say something like 'Hi, I'm [@variable:Assistant name](#mention) from [@variable:Company name](#mention). How can I help you today?'\n2. Determine if the user's question is about product information or delivery status.\n3. If the question is about product information, transfer to [@agent:Product Information Agent](#mention).\n4. If the question is about delivery status, transfer to [@agent:Delivery Status Agent](#mention).\n5. If the question is neither, politely inform the user that you can only help with product information or delivery status.\n6. Return the final answer to the user.\n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Routing product information questions.\n- Routing delivery status questions.\n\n❌ Out of Scope:\n- Directly answering product or delivery questions.\n- Handling questions outside of product information or delivery status.\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- Clearly identify the type of user query.\n- Route to the correct agent.\n\n🚫 Don'ts:\n- Do not attempt to answer questions directly.\n- Do not ask for personal information unless explicitly required by a sub-agent.\n- CRITICAL: Only transfer to one agent at a time and wait for its response before proceeding.\n\n",
 "model": "google/gemini-2.5-flash",
 "toggleAble": true,
 "ragReturnType": "chunks",
 "ragK": 3,
    "outputVisibility": "user_facing",
    "controlType": "retain"
  }
}
\`\`\`

#### b. Product Information Agent

I'll create an agent to handle product information questions. You can later connect you data sources to provide the knowledge:

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Product Information Agent
 {
  "change_description": "Created the product information agent.",
  "config_changes": {
    "name": "Product Information Agent",
 "type": "conversation",
 "description": "Answers product information questions using RAG data sources.",
 "disabled": false,
 "instructions": "## 🧑‍💼 Role:\nYou are an internal agent that answers product information questions using RAG data sources. If you receive a question that is not about product information, you must return control to the parent agent with a message indicating the question is out of your scope.\n\n---\n## ⚙️ Steps to Follow:\n1. Receive the product information question from the parent agent.\n2. Determine if the question is about product information.\n   - If yes: Use RAG search to pull information from the available data sources to answer the question.\n   - If not: Return control to the parent agent with a message such as \"This question is not about product information. Returning to parent agent.\"\n3. Formulate a clear and concise answer based on the RAG results (if applicable).\n4. If question is out of scope call [@agent:Product & Delivery Assistant](#mention) \n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Answering product information questions using RAG.\n- Returning control to parent if the question is out of scope.\n\n❌ Out of Scope:\n- Handling delivery status questions.\n- Interacting directly with the user.\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- Use RAG search to find relevant information for product questions.\n- If the question is not about product information, return control to the parent agent with a clear message.\n\n🚫 Don'ts:\n- Do not answer questions outside of product information.\n- Do not interact with the user directly.\n- Do not ignore out-of-scope questions; always return to parent.\n",
 "model": "google/gemini-2.5-flash",
 "locked": false,
 "toggleAble": true,
 "ragReturnType": "chunks",
 "ragK": 3,
 "outputVisibility": "user_facing",
 "controlType": "retain",
 "maxCallsPerParentAgent": 3
 }
}
\`\`\`

#### c. Delivery Status Agent

I'll create an agent to handle delivery status questions that uses a mocked tool for now. You can later connect your MCP tool to it. 

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Delivery Status Agent
 {
  "change_description": "Created the delivery status agent.",
  "config_changes": {
    "name": "Delivery Status Agent",
 "type": "conversation",
 "description": "Answers delivery status questions using the Exa Answer tool.",
 "disabled": false,
 "instructions": "## 🧑‍💼 Role:\nYou are an internal agent that answers delivery status questions. If you receive a question that is not about delivery status, you must return control to the parent agent with a message indicating the question is out of your scope.\n\n---\n## ⚙️ Steps to Follow:\n1. Receive the delivery status question from the parent agent.\n2. Determine if the question is about delivery status.\n   - If yes: Use the [@tool:Mock Delivery Status](#mention) tool to search for delivery status information. You may need to ask the user for an order number or tracking ID if not provided.\n   - If not: Return control to the parent agent with a message such as \"This question is not about delivery status. Returning to parent agent.\"\n3. Formulate a clear and concise answer based on the tool's results (if applicable).\n4. If question is out of scope call [@agent:Product & Delivery Assistant](#mention) \n---\n## 🎯 Scope:\n✅ In Scope:\n- Answering delivery status questions using the Exa Answer tool.\n- Returning control to parent if the question is out of scope.\n\n❌ Out of Scope:\n- Handling product information questions.\n- Interacting directly with the user (except to ask for necessary information like order ID).\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- Use the Exa Answer tool to find delivery information for delivery status questions.\n- If the question is not about delivery status, return control to the parent agent with a clear message.\n- Ask for order details if needed.\n\n🚫 Don'ts:\n- Do not answer questions outside of delivery status.\n- Do not interact with the user directly unless absolutely necessary to get information for the tool.\n- Do not ignore out-of-scope questions; always return to parent.\n",
 "model": "gpt-4.1",
 "locked": false,
 "toggleAble": true,
 "ragReturnType": "chunks",
 "ragK": 3,
 "outputVisibility": "user_facing",
 "controlType": "retain",
 "maxCallsPerParentAgent": 3
 }
}
\`\`\`

---

Once you review and apply the changes, you can try out a basic chat first. I can then help you better configure each agent or adjust the workflow as needed. Would you like to customize any step or add more details?

---


`;