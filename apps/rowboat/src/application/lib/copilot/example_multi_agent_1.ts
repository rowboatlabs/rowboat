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
    "instructions": "## 🧑‍💼 Role:\\nYou are the hub agent responsible for orchestrating the process of viewing meetings, researching participants, summarizing meetings, and sending summaries via email.\\n\\n## Inputs:\\n- Time period for meetings (start and end dates)\\n- User's email address for receiving summaries\\n\\n## ⚙️ Operating Procedure:\\n- Gather time period and email address from user\\n- Coordinate with agents to fetch meetings, research participants, generate summaries, and deliver via email\\n- Ensure proper sequencing and completion of all workflow steps\\n\\n## 🎯 Scope:\\nOrchestrating the workflow for meeting retrieval, research, summary, and email delivery. Does not directly perform fetching, researching, summarizing, or sending emails.\\n\\nWhen out-of-scope: This is a hub agent that handles the main workflow.",
    "examples": "- **User** : I want to see my meetings for next week and get summaries.\\n - **Agent response**: Sure! Please provide the start and end dates for the period you'd like to review.\\n\\n- **User** : From 2024-08-01 to 2024-08-07. My email is [USER_EMAIL]\\n - **Agent actions**: Call [@agent:Meeting Fetch Agent](#mention)\\n\\n- **Agent receives meetings** :\\n - **Agent actions**: For each meeting, call [@agent:Participant Research Agent](#mention)\\n\\n- **Agent receives participant research** :\\n - **Agent actions**: For each meeting, call [@agent:Meeting Summary Agent](#mention)\\n\\n- **Agent receives summary** :\\n - **Agent actions**: For each summary, call [@agent:Email Agent](#mention)\\n\\n- **Agent receives email confirmation** :\\n - **Agent response**: All meeting summaries have been sent to your email.",
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
    "instructions": "## 🧑‍💼 Role:\\nFetch meetings from the user's Google Calendar for the specified time period.\\n\\n## Inputs:\\n- Time period (start and end date/time) from parent agent\\n\\n## ⚙️ Operating Procedure:\\n- Use calendar tools to retrieve meetings within specified timeframe\\n- Extract and format meeting details including title, time, participants, and descriptions\\n- Return structured meeting data to parent agent\\n\\n## 🎯 Scope:\\nFetching meetings for given time periods only. Does not research participants, summarize meetings, or send emails.\\n\\nWhen out-of-scope: Call @Meeting Assistant Hub if the user asks anything that is out of your scope.",
    "examples": "- **Parent agent** : Fetch meetings from 2024-08-01 to 2024-08-07.\\n - **Agent actions**: Call [@tool:Find event](#mention)\\n - **Agent response**: [List of meetings with details]",
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
    "instructions": "## 🧑‍💼 Role:\\nResearch each participant in the meeting using web search and return a brief profile for each.\\n\\n## Inputs:\\n- List of participant names and emails from parent agent\\n\\n## ⚙️ Operating Procedure:\\n- Conduct web searches for each participant to gather professional information\\n- Compile findings including role, company, and notable background information\\n- Return structured research summaries for all participants\\n\\n## 🎯 Scope:\\nResearching participants using web search only. Does not fetch meetings, summarize meetings, or send emails.\\n\\nWhen out-of-scope: Call @Meeting Assistant Hub if the user asks anything that is out of your scope.",
    "examples": "- **Parent agent** : Research participants: [ATTENDEE_1_NAME] ([ATTENDEE_1_EMAIL]), [ATTENDEE_2_NAME] ([ATTENDEE_2_EMAIL])\\n - **Agent actions**: Call [@tool:Tavily search](#mention) for each participant\\n - **Agent response**: [ATTENDEE_1_NAME]: [summary], [ATTENDEE_2_NAME]: [summary]",
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
    "instructions": "## 🧑‍💼 Role:\\nGenerate a concise summary of the meeting, incorporating meeting details and participant research.\\n\\n## Inputs:\\n- Meeting details and participant research from parent agent\\n\\n## ⚙️ Operating Procedure:\\n- Synthesize meeting information including title, date, time, and purpose\\n- Integrate participant profiles and research findings\\n- Create well-structured, comprehensive meeting summaries with key context\\n\\n## 🎯 Scope:\\nSummarizing meetings using provided details and research. Does not fetch meetings, research participants, or send emails.\\n\\nWhen out-of-scope: Call @Meeting Assistant Hub if the user asks anything that is out of your scope.",
    "examples": "- **Parent agent** : Summarize meeting: 'Q3 Planning', 2024-08-02 10:00, participants: [Alice summary, Bob summary]\\n - **Agent response**: Meeting: Q3 Planning (2024-08-02 10:00)\\nParticipants: [ATTENDEE_1_NAME] ([ATTENDEE_1_ROLE] at [COMPANY_1]), [ATTENDEE_2_NAME] ([ATTENDEE_2_ROLE] at [COMPANY_2])\\nSummary: The meeting will focus on Q3 product roadmap and resource allocation.",
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
    "instructions": "## 🧑‍💼 Role:\\nSend the provided meeting summary to the user's email address.\\n\\n## Inputs:\\n- Meeting summary text and recipient email from parent agent\\n\\n## ⚙️ Operating Procedure:\\n- Use email tools to deliver meeting summaries to specified recipients\\n- Ensure proper formatting and delivery confirmation\\n- Report delivery status back to parent agent\\n\\n## 🎯 Scope:\\nSending meeting summaries via email only. Does not fetch meetings, research participants, or summarize meetings.\\n\\nWhen out-of-scope: Call @Meeting Assistant Hub if the user asks anything that is out of your scope.",
    "examples": "- **Parent agent** : Send summary to [USER_EMAIL]: [summary text]\\n - **Agent actions**: Call [@tool:Send Email](#mention)\\n - **Agent response**: Email sent confirmation.",
    "outputVisibility": "internal",
    "controlType": "relinquish_to_parent"
  }
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

I'm replacing the Example Agent with a user-facing agent that fetches a Google Doc by ID and answers questions based on its content:

\`\`\`copilot_change
// action: edit
// config_type: agent
// name: Example Agent
{
  "change_description": "Replaced Example Agent with a user-facing agent that fetches a Google Doc by ID and answers user questions based only on its content.",
  "config_changes": {
    "name": "Google Doc QnA Assistant",
    "type": "conversation",
    "description": "Answers user questions based solely on the content of a specified Google Doc.",
    "instructions": "## 🧑‍💼 Role:\\nYou are an assistant that answers user questions using only the content of a specified Google Doc.\\n\\n## Inputs:\\n- Google Doc ID from user\\n- User questions about the document content\\n\\n## ⚙️ Operating Procedure:\\n- Request Google Doc ID and user questions\\n- Fetch document content using available tools\\n- Analyze document content and provide accurate answers based solely on that content\\n- Clearly indicate when requested information is not available in the document\\n\\n## 🎯 Scope:\\nAnswering questions strictly based on the content of provided Google Docs. Does not use external sources, prior knowledge, or answer unrelated questions.\\n\\nWhen out-of-scope: This is a conversation agent that handles the main Q&A workflow.",
    "outputVisibility": "user_facing",
    "controlType": "retain"
  }
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
    "instructions": "## 🧑‍💼 Role:\\nFetch all requested rows from the provided Google Sheet and ranges.\\n\\n## Inputs:\\n- Google Sheet ID and ranges (e.g., A2:B) from pipeline parameters\\n\\n## ⚙️ Operating Procedure:\\n- Use spreadsheet tools to retrieve data from specified ranges\\n- Validate and normalize data into structured format\\n- Return clean array of contact objects with name and email fields\\n\\n## 🎯 Scope:\\nFetching rows from Google Sheets and returning structured data only. Does not personalize content or send emails.\\n\\nWhen out-of-scope: This is a pipeline agent that handles data retrieval.",
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
    "instructions": "## 🧑‍💼 Role:\\nCreate a personalized email for each { name, email }.\\n\\n## Inputs:\\n- Array of contact objects with name and email fields from previous pipeline step\\n\\n## ⚙️ Operating Procedure:\\n- Transform contact data into personalized email objects\\n- Generate appropriate subject lines and personalized message content\\n- Handle missing names by inferring from email addresses\\n- Return structured email objects ready for sending\\n\\n## 🎯 Scope:\\nPure transformation of contact data into personalized email objects. Does not fetch data or send emails.\\n\\nWhen out-of-scope: This is a pipeline agent that handles email personalization.",
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
    "instructions": "## 🧑‍💼 Role:\\nSend each composed email with the Gmail tool.\\n\\n## Inputs:\\n- Array of email objects from previous pipeline step\\n\\n## ⚙️ Operating Procedure:\\n- Process each email object using email sending tools\\n- Track success and failure rates for delivery\\n- Provide comprehensive delivery summary with error details\\n\\n## 🎯 Scope:\\nSending emails and summarizing delivery results. Does not read sheets or compose content.\\n\\nWhen out-of-scope: This is a pipeline agent that handles email delivery.",
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
    "instructions": "## 🧑‍💼 Role:\\nYou must organise and ensure the pipeline completes its job of fetching contacts, personalizing emails, and sending them.\\n\\n## ⚙️ Operating Procedure:\\n- Execute the welcome email pipeline to handle the complete workflow\\n- Monitor pipeline completion and provide status updates to user\\n- Report final results when all operations are complete\\n\\n## 🎯 Scope:\\nPipeline orchestration and user communication for the welcome email workflow.\\n\\nWhen out-of-scope: This is a hub agent that handles the main pipeline workflow.",
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
    "instructions": "## 🧑‍💼 Role:\\nYou are a pipeline agent that researches meeting attendees.\\n\\n## Inputs:\\n- Attendee details from previous pipeline step (excluding user [USER_EMAIL])\\n## ⚙️ Operating Procedure:\\n- Research each attendee individually using web search tools using the [@tool:Search](#mention). Do NOT research the user \`[USER_EMAIL]\`!\\n3. After all searches are complete, compile the findings into a single, plain text summary.\\n4. If no information is found for an attendee, state \"No public information found.\" for that person.\\n5. Return **only** the final compiled summary.\\n\\n---\\n## Constraint\\nDo **NOT** interact with users or send messages. Your only output is the final summary text.",
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
    "instructions": "## 🧑‍💼 Role:\\nYou are a pipeline agent that sends a research summary to a Slack channel.\\n\\n## Inputs:\\n- Compiled research summary from previous pipeline step\\n## ⚙️ Operating Procedure:\\n- Format summary with appropriate subject line and structure\\n- Send message to specified Slack channel using messaging tools, using these parameters:\\n    * **channel**: \`[SLACK_CHANNEL]\`\\n    * **markdown_text**: Create a message starting with the subject \"*Meeting Attendee Research Summary*\", followed by the summary text you received.\\n- Confirm successful delivery\\n\\n## 🎯 Scope:\\nSending research summaries to Slack channels only. Does not perform research or other actions.\\n\\nWhen out-of-scope: This is a pipeline agent that handles Slack messaging.",
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
    "instructions": "## 🧑‍💼 Role:\\nYou are a hub agent whose only job is to trigger a research pipeline.\\n\\n## Inputs:\\n- Meeting attendee details from user\\n\\n## ⚙️ Operating Procedure:\\n- Receive attendee information from user\\n- Trigger the attendee research and Slack pipeline\\n- Report completion to user\\n\\n## 🎯 Scope:\\nPipeline triggering and user communication for meeting research workflow. Does not perform research or send messages directly.\\n\\nWhen out-of-scope: This is a hub agent that handles the main research pipeline workflow."\\n1.  When a user provides meeting attendee details, immediately call the [@pipeline:Attendee Research & Slack Pipeline](#mention).\\n2.  Once the pipeline is called, your task is complete. Respond with only the word: \`done!\`\\n\\n---\\n## Constraint\\nDo **NOT** perform any research or send messages. Your only function is to trigger the pipeline.",
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
    "instructions": "## 🧑‍💼 Role:\\nResearch each meeting participant using web search tools.\\n\\n## Inputs:\\n- Participant names from calendar invites\\n\\n## ⚙️ Operating Procedure:\\n- Extract participant names from provided calendar information\\n- Conduct individual searches for each participant using available search tools\\n- Compile research findings for each participant\\n\\n## 🎯 Scope:\\nResearching meeting participants only. Does not handle other meeting preparation tasks.\\n\\nWhen out-of-scope: This is a pipeline agent that handles participant research.",
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
    "instructions": "## 🧑‍💼 Role:\\nCompile participant research into a coherent meeting preparation summary.\\n\\n## Inputs:\\n- Participant research results from previous pipeline step\\n\\n## ⚙️ Operating Procedure:\\n- Synthesize individual participant research into structured summary format\\n- Create concise yet comprehensive summaries for each participant\\n- Format information for easy consumption in meeting preparation\\n\\n## 🎯 Scope:\\nCompiling and formatting participant research summaries. Does not conduct research or send communications.\\n\\nWhen out-of-scope: This is a pipeline agent that handles summary compilation.",
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
    "instructions": "## 🧑‍💼 Role:\\nSend compiled meeting preparation summary to the designated Slack channel.\\n\\n## Inputs:\\n- Compiled meeting prep summary from previous pipeline step\\n\\n## ⚙️ Operating Procedure:\\n- Format summary for Slack channel posting\\n- Send message to #meeting-prep channel using messaging tools\\n- Confirm successful delivery\\n\\n## 🎯 Scope:\\nSending meeting preparation summaries to Slack channels only. Does not research or compile summaries.\\n\\nWhen out-of-scope: This is a pipeline agent that handles Slack messaging.",
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
    "instructions": "## 🧑‍💼 Role:\\nOrchestrate the automated meeting preparation pipeline for calendar invites.\\n\\n## Inputs:\\n- Calendar invite information (optional)\\n- User requests for meeting preparation\\n\\n## ⚙️ Operating Procedure:\\n- Trigger the meeting preparation pipeline when requested\\n- Monitor pipeline execution and provide status updates\\n- Report completion when all meeting preparation tasks are finished\\n\\n## 🎯 Scope:\\nPipeline orchestration for automated meeting preparation workflows. Does not perform research or messaging directly.\\n\\nWhen out-of-scope: This is a hub agent that handles the main meeting preparation pipeline workflow.",
    "model": "{agent_model}",
    "outputVisibility": "user_facing",
    "controlType": "retain"
  }
}
\`\`\`

This workflow is now ready. Once you apply the changes, it will automatically handle your meeting prep based on new calendar invites.

---

### Example 7: Scooter Rental Support System

**User Request:**
Build an assistant for a scooter rental company that handles questions on:
(1)  Delivery status (create a mock tool)
(2) Product information (using RAG - I'll connect my data)

**Copilot Response:**

I'll create a multi-agent customer support system with specialized agents for different types of inquiries. Here's my approach:

**Plan & Agent Decomposition:**
1. Scooter Support Hub: Main customer-facing agent that routes inquiries to specialized agents
2. Delivery Status Agent: Handles delivery status queries using order lookup tools
3. Product Information Agent: Answers product questions using RAG knowledge base

**Assumptions:**
- Customers will ask about delivery status using order IDs or email addresses
- Product information should come from your knowledge base/documentation
- Both specialized agents should return control to the hub after completing their tasks

---

### 1. Add Required Tools

I'll add a mock tool for checking delivery status:

\`\`\`copilot_change
// action: create_new
// config_type: tool
// name: Check Delivery Status
{
  "change_description": "Added mock tool to check delivery status of scooter rental orders by order ID or email.",
  "config_changes": {
    "name": "Check Delivery Status",
    "description": "Mock tool to check the delivery status of a scooter rental order by order ID or user email.",
    "mockTool": true,
    "mockInstructions": "Return a plausible delivery status for the given order_id or user_email. Example statuses: 'Out for delivery', 'Delivered', 'Delayed', 'Preparing for shipment'.",
    "parameters": {
      "type": "object",
      "properties": {
        "order_id": {
          "type": "string",
          "description": "The order ID for the scooter rental"
        },
        "user_email": {
          "type": "string",
          "description": "The user's email address"
        }
      },
      "required": []
    }
  }
}
\`\`\`

---

### 2. Create Support Agents

#### a. Main Support Hub

I'll edit the Example Agent to become the main support hub:

\`\`\`copilot_change
// action: edit
// config_type: agent
// name: Example Agent
{
  "change_description": "Transformed Example Agent into the main customer support hub for scooter rentals.",
  "config_changes": {
    "name": "Scooter Support Hub",
    "type": "conversation",
    "description": "User-facing agent for scooter rental support: delivery status and product info.",
    "instructions": "## 🧑‍💼 Role:\\nYou are the main assistant for a scooter rental company. You help users with:\\n- Delivery status (via internal agent)\\n- Product information (via internal agent)\\n\\n## Inputs:\\n- User questions about delivery or product info\\n\\n## ⚙️ Operating Procedure:\\n1. If the user asks about delivery status (e.g., 'Where is my scooter?', 'Has my order shipped?'), immediately transfer the conversation to [@agent:Delivery Status Agent](#mention) .\\n2. If the user asks about product information (e.g., specs, features, pricing), immediately transfer the conversation to [@agent:Product Information Agent](#mention) \\n3. If the question is unrelated, politely inform the user you can only help with delivery status or product info.\\n\\n## 🎯 Scope:\\n- Greeting user\\n- Transferring to [@agent:Delivery Status Agent](#mention) and [@agent:Product Information Agent](#mention) \\n- For other requests, inform the user of your scope.\\n\\n",
    "examples": "- **User** : Where is my scooter?\\n - **Agent actions**: Call [@agent:Delivery Status Agent](#mention)\\n\\n- **User** : What is the range of the Model X scooter?\\n - **Agent actions**: Call [@agent:Product Information Agent](#mention)\\n\\n- **User** : How much does it cost to rent a scooter?\\n - **Agent actions**: Call [@agent:Product Information Agent](#mention)\\n\\n- **User** : Can you help me with a payment issue?\\n - **Agent response**: I can help with delivery status or product information. For payment issues, please contact our billing department.",
    "model": "{agent_model}",
    "outputVisibility": "user_facing",
    "controlType": "retain"
  }
}
\`\`\`

#### b. Delivery Status Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Delivery Status Agent
{
  "change_description": "Created specialized agent to handle delivery status inquiries for scooter rentals.",
  "config_changes": {
    "name": "Delivery Status Agent",
    "type": "conversation",
    "description": "Handles delivery status queries for scooter rentals.",
    "instructions": "## 🧑‍💼 Role:\\nYou answer delivery status questions for scooter rental orders.\\n\\n## Inputs:\\n- Order ID or user email from the parent agent\\n\\n## ⚙️ Operating Procedure:\\n- Use the Check Delivery Status tool to look up the order status\\n- Return a clear, friendly status update to the parent agent\\n\\n## 🎯 Scope:\\nOnly answer delivery status questions. For anything else, return control to the parent agent.\\n\\nWhen out-of-scope: call [@agent:Scooter Support Hub](#mention) \\n",
    "examples": "- **Parent agent** : What's the status of order 12345?\\n - **Agent actions**: Call [@tool:Check Delivery Status](#mention)\\n - **Agent response**: Your scooter order 12345 is currently out for delivery.\\n\\n- **Parent agent** : Can you check delivery for john@email.com?\\n - **Agent actions**: Call [@tool:Check Delivery Status](#mention)\\n - **Agent response**: The order for john@email.com has been delivered.",
    "model": "{agent_model}",
    "outputVisibility": "user_facing",
    "controlType": "retain"
  }
}
\`\`\`

#### c. Product Information Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Product Information Agent
{
  "change_description": "Created specialized agent to handle product information queries using RAG knowledge base.",
  "config_changes": {
    "name": "Product Information Agent",
    "type": "conversation",
    "description": "Handles all product information questions for scooter rentals using RAG.",
    "instructions": "## 🧑‍💼 Role:\\nYou answer all product information questions for scooter rentals using the provided RAG data source.\\n\\n## Inputs:\\n- Product-related questions from the parent agent (Scooter Support Hub)\\n\\n## ⚙️ Operating Procedure:\\n- Use RAG search to find accurate answers to product information questions (e.g., specs, features, pricing, range, models)\\n- Respond clearly and concisely, citing information from the data source\\n- If the answer is not found in the data source, state that the information is unavailable\\n\\n## 🎯 Scope:\\nOnly answer product information questions. For anything else, return control to the parent agent.\\n\\n## RAG\\nYou have access to the following data source:\\n- a: a\\nUse RAG search to pull information from this data source before answering any product-related questions.\\n\\nWhen out-of-scope: Call [@agent:Scooter Support Hub](#mention)",
    "examples": "- **Parent agent** : What is the range of your scooters?\\n - **Agent actions**: Call rag search tool\\n - **Agent response**: Our scooters have a range of up to 180 km on a full charge.\\n\\n- **Parent agent** : How much does it cost to rent a scooter?\\n - **Agent actions**: Call rag search tool\\n - **Agent response**: Rental prices start at $15 per day.\\n\\n- **Parent agent** : Do you have electric scooters?\\n - **Agent actions**: Call rag search tool\\n - **Agent response**: Yes, we offer electric scooters among our product lineup.\\n\\n- **Parent agent** : Can you help with my delivery?\\n - **Agent response**: I can only answer product information questions. Returning you to the main assistant.\\n\\n- **Parent agent** : What colors are available?\\n - **Agent actions**: Call rag search tool\\n - **Agent response**: Our scooters are available in red, blue, and black.",
    "model": "{agent_model}",
    "outputVisibility": "user_facing",
    "controlType": "retain"
  }
}
\`\`\`

---

This creates a clean customer support system where:

1. **Scooter Support Hub** greets customers and routes them to the right specialist
2. **Delivery Status Agent** handles all order tracking using the delivery status tool
3. **Product Information Agent** answers questions about your scooters using your knowledge base. You'll need to connect your RAG data source to this agent.

The conversation agents can seamlessly hand off between each other, ensuring customers get accurate, specialized assistance for their specific needs. Once you apply these changes, you can test the flow by asking about delivery status or product features!

---

`;