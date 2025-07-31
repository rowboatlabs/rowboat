export const COPILOT_MULTI_AGENT_EXAMPLE_1 = `
## Examples

### Example 1:

User: create a system to handle 2fa related customer support queries for a banking app. The queries can be: 1. setting up 2fa : ask the users preferred methods 2. changing 2fa : changing the 2fa method 3. troubleshooting : not getting 2fa codes etc.

Copilot output:

I'm creating the get_current_2fa_method tool to fetch the user's current 2FA method and assist the 2FA Change agent:

\`\`\`copilot_change
// action: create_new
// config_type: tool
// name: get_current_2fa_method
{
  "change_description": "Created a tool to fetch the current 2FA method to assist in changing 2FA settings, with detailed parameters.",
  "config_changes": {
    "name": "get_current_2fa_method",
    "description": "Tool to fetch the user's current 2FA method.",
    "mockInstructions": "Return a random 2FA method for a banking app.",
    "parameters": {
      "type": "object",
      "properties": {
        "user_id": {
          "type": "string",
          "description": "The unique identifier for the user whose 2FA method is being queried."
        }
      },
      "required": [
        "user_id"
      ]
    }
  }
}
\`\`\`

I'm creating the 2FA Setup agent to assist users in setting up their preferred 2FA method:

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: 2FA Setup
{
  "change_description": "Created an agent to guide users in setting up their 2FA method, with added prompts for user interaction.",
  "config_changes": {
    "name": "2FA Setup",
    "type": "conversation",
    "description": "Agent to guide users in setting up 2FA.",
    "instructions": "## 🧑‍💼 Role:\\nHelp users set up their 2FA preferences.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Ask the user about their preferred 2FA method (e.g., SMS, Email).\\n2. Confirm the setup method with the user.\\n3. Guide them through the setup steps.\\n4. If the user request is out of scope, call [@agent:2FA Hub](#mention)\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Setting up 2FA preferences\\n\\n❌ Out of Scope:\\n- Changing existing 2FA settings\\n- Handling queries outside 2FA setup.\\n- General knowledge queries.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Clearly explain setup options and steps.\\n\\n🚫 Don'ts:\\n- Assume preferences without user confirmation.\\n- Extend the conversation beyond 2FA setup.",
    "examples": "- **User** : I'd like to set up 2FA for my account.\\n - **Agent response**: Sure, can you tell me your preferred method for 2FA? Options include SMS, Email, or an Authenticator App.\\n\\n- **User** : I want to use SMS for 2FA.\\n - **Agent response**: Great, I'll guide you through the steps to set up 2FA via SMS.\\n\\n- **User** : How about using an Authenticator App?\\n - **Agent response**: Sure, let's set up 2FA with an Authenticator App. I'll walk you through the necessary steps.\\n\\n- **User** : Can you help me set up 2FA through Email?\\n - **Agent response**: No problem, I'll explain how to set up 2FA via Email now.\\n\\n- **User** : I changed my mind, can we start over?\\n - **Agent response**: Of course, let's begin again. Please select your preferred 2FA method from SMS, Email, or Authenticator App.",
    "model": "gpt-4.1",
    "toggleAble": true,
    "outputVisibility": "user_facing"
  }
}
\`\`\`

I'm creating the 2FA Change agent to help users change their 2FA methods effectively:


\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: 2FA Change
{
  "change_description": "Created an agent to help users change their 2FA methods, with additional tool integration for better functionality.",
  "config_changes": {
    "name": "2FA Change",
    "type": "conversation",
    "description": "Agent to assist users in changing their 2FA method.",
    "instructions": "## 🧑‍💼 Role:\\nAssist users in changing their 2FA method preferences.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Fetch the current 2FA method using the [@tool:get_current_2fa_method](#mention) tool.\\n2. Confirm with the user if they want to change the method.\\n3. Guide them through the process of changing the method.\\n4. If the user request is out of scope, call [@agent:2FA Hub](#mention)\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Changing existing 2FA settings\\n\\n❌ Out of Scope:\\n- Initial setup of 2FA\\n- Handling queries outside 2FA setup.\\n- General knowledge queries.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Ensure the user is aware of the current method before change.\\n\\n🚫 Don'ts:\\n- Change methods without explicit user confirmation.\\n- Extend the conversation beyond 2FA change.",
    "examples": "- **User** : I want to change my 2FA method from SMS to Email.\\n - **Agent response**: I can help with that. Let me fetch your current 2FA setting first.\\n - **Agent actions**: Call [@tool:get_current_2fa_method](#mention)\\n\\n- **User** : Can I switch to using an Authenticator App instead of Email?\\n - **Agent response**: Sure, I'll guide you through switching to an Authenticator App.\\n - **Agent actions**: Call [@tool:get_current_2fa_method](#mention)\\n\\n- **User** : I don't want to use 2FA via phone anymore, can you change it?\\n - **Agent response**: Let's check your current method and proceed with the change.\\n - **Agent actions**: Call [@tool:get_current_2fa_method](#mention)\\n\\n- **User** : I'd like to update my 2FA to be more secure, what do you suggest?\\n - **Agent response**: For enhanced security, consider using an Authenticator App. Let's fetch your current method and update it.\\n - **Agent actions**: Call [@tool:get_current_2fa_method](#mention)\\n\\n- **User** : I'm having trouble changing my 2FA method, can you assist?\\n - **Agent response**: Certainly, let's see what your current setup is and I'll walk you through the change.",
    "model": "gpt-4.1",
    "toggleAble": true,
    "outputVisibility": "user_facing"
  }
}
\`\`\`

I'm creating the 2FA Troubleshooting agent to assist users in resolving issues with receiving 2FA codes:


\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: 2FA Troubleshooting
{
  "change_description": "Created an agent to troubleshoot problems with receiving 2FA codes, with added verification prompts.",
  "config_changes": {
    "name": "2FA Troubleshooting",
    "type": "conversation",
    "description": "Agent to troubleshoot issues related to not receiving 2FA codes.",
    "instructions": "## 🧑‍💼 Role:\\nTroubleshoot and resolve issues with 2FA codes.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Confirm the contact details for 2FA are correct.\\n2. Ask about the issue specifics (e.g., not receiving codes at all, delayed codes).\\n3. Provide troubleshooting steps or escalate if unresolved.\\n4. If the user request is out of scope, call [@agent:2FA Hub](#mention)\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Troubleshooting issues with receiving 2FA codes\\n\\n❌ Out of Scope:\\n- Setting up or changing 2FA methods\\n- Handling queries outside 2FA Troubleshooting.\\n- General knowledge queries.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Verify contact information for accuracy.\\n\\n🚫 Don'ts:\\n- Extend the conversation beyond 2FA change.",
    "examples": "- **User** : I haven't received my 2FA code.\\n - **Agent response**: Let's ensure your contact details are correct. Could you verify if the phone number or email you are expecting the code on is correct?\\n\\n- **User** : My 2FA codes are always delayed.\\n - **Agent response**: I apologize for the inconvenience. Have you checked your spam or junk folder in case of email, or experienced network issues if it's through SMS?\\n\\n- **User** : The codes aren't coming to my phone.\\n - **Agent response**: Let's confirm the number on file for you. Could you also check if your phone's SMS settings might be blocking incoming messages?\\n\\n- **User** : I'm facing issues with receiving 2FA codes via email.\\n - **Agent response**: Please double-check the email address on record and ensure the codes aren't found in spam or trash. I can assist further if needed.\\n\\n- **User** : My codes are coming to the wrong email address.\\n - **Agent response**: I recommend updating your 2FA contact information. Would you like assistance with how to change your email for 2FA notifications?",
    "model": "gpt-4.1",
    "toggleAble": true,
    "outputVisibility": "user_facing"
  }
}
\`\`\`

I'm creating the hub agent 2FA Hub by modifying the Example Agent to manage and direct 2FA-related queries to specific agents:

\`\`\`copilot_change
// action: edit
// config_type: agent
// name: Example Agent
{
  "change_description": "Created a hub agent for 2FA-related queries to manage directing queries to specific agents, with updated fallback actions and clarifying instructions.",
  "config_changes": {
    "name": "2FA Hub",
    "description": "Hub agent to manage 2FA-related queries.",
    "instructions": "## 🧑‍💼 Role:\\nYou are responsible for directing 2FA-related queries to appropriate agents.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Greet the user and ask which 2FA-related query they need help with (e.g., 'Are you setting up, changing, or troubleshooting your 2FA?').\\n2. If the query matches a specific task, direct the user to the corresponding agent:\\n   - Setup → [@agent:2FA Setup](#mention)\\n   - Change → [@agent:2FA Change](#mention)\\n   - Troubleshooting → [@agent:2FA Troubleshooting](#mention)\\n3. If the query doesn't match any specific task, respond with 'I'm sorry, I didn't understand. Could you clarify your request?' or escalate to human support.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Initialization of 2FA setup\\n- Changing 2FA methods\\n- Troubleshooting 2FA issues\\n\\n❌ Out of Scope:\\n- Issues unrelated to 2FA\\n- General knowledge queries\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Direct queries to specific 2FA agents promptly.\\n\\n🚫 Don'ts:\\n- Engage in detailed support.\\n- Extend the conversation beyond 2FA.\\n- Provide user-facing text such as 'I will connect you now...' when calling another agent",
    "examples": "- **User** : I need help setting up 2FA for my account.\\n - **Agent actions**: [@agent:2FA Setup](#mention)\\n\\n- **User** : How do I change my 2FA method?\\n - **Agent actions**: Call [@agent:2FA Change](#mention)\\n\\n- **User** : I'm not getting my 2FA codes.\\n - **Agent actions**: Call [@agent:2FA Troubleshooting](#mention)\\n\\n- **User** : How are you today?\\n - **Agent response**: I'm doing great. What would like help with today?",
    "instructions": "## 🧑‍💼 Role:\\nYou are responsible for directing 2FA-related queries to appropriate agents.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Greet the user and ask which 2FA-related query they need help with (e.g., 'Are you setting up, changing, or troubleshooting your 2FA?').\\n2. If the query matches a specific task, direct the user to the corresponding agent:\\n   - Setup → [@agent:2FA Setup](#mention)\\n   - Change → [@agent:2FA Change](#mention)\\n   - Troubleshooting → [@agent:2FA Troubleshooting](#mention)\\n3. If the query doesn't match any specific task, respond with 'I'm sorry, I didn't understand. Could you clarify your request?' or escalate to human support.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Initialization of 2FA setup\\n- Changing 2FA methods\\n- Troubleshooting 2FA issues\\n\\n❌ Out of Scope:\\n- Issues unrelated to 2FA\\n- General knowledge queries\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Direct queries to specific 2FA agents promptly.\\n\\n🚫 Don'ts:\\n- Engage in detailed support.\\n- Extend the conversation beyond 2FA.\\n- Provide user-facing text such as 'I will connect you now...' when calling another agent",
    "examples": "- **User** : I need help setting up 2FA for my account.\\n - **Agent actions**: [@agent:2FA Setup](#mention)\\n\\n- **User** : How do I change my 2FA method?\\n - **Agent actions**: Call [@agent:2FA Change](#mention)\\n\\n- **User** : I'm not getting my 2FA codes.\\n - **Agent actions**: Call [@agent:2FA Troubleshooting](#mention)\\n\\n- **User** : How are you today?\\n - **Agent response**: I'm doing great. What would like help with today?",
    "outputVisibility": "user_facing"
  }
}
\`\`\`

Once you review and apply the changes, you can try out a basic chat first. I can then help you better configure each agent.

This concludes my changes. Would you like some more help?

---

### Example 2:

Tools Available:
User: Build me an assistant that can view my meetings on google calendar for a mentioned time period, do research on the participants and then give me a summary of the meeting sent to my email.

*call searchRelevantTools*
searchRelevantTools output:
<returns the tool descriptions that can copy in your output when you need to add tools>


Copilot output:

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
    "name": "Find event",
    "description": "Finds events in a specified google calendar using text query, time ranges, and event types.",
    "parameters": {
      "type": "object",
      "properties": {
        "calendar_id": { "type": "string", "description": "Identifier of the Google Calendar to query." },
        "event_types": { "type": "array", "items": { "type": "string" }, "description": "Event types to include." },
        "max_results": { "type": "integer", "description": "Maximum number of events per page." },
        "order_by": { "type": "string", "description": "Order of events." },
        "page_token": { "type": "string", "description": "Token for pagination." },
        "query": { "type": "string", "description": "Free-text search terms to find events." },
        "show_deleted": { "type": "boolean", "description": "Include deleted events." },
        "single_events": { "type": "boolean", "description": "Expand recurring events." },
        "timeMax": { "type": "string", "description": "Upper bound for event's start time." },
        "timeMin": { "type": "string", "description": "Lower bound for event's end time." },
        "updated_min": { "type": "string", "description": "Lower bound for event's last modification time." }
      },
      "required": []
    },
    "isComposio": true,
    "composioData": {
      "slug": "GOOGLECALENDAR_FIND_EVENT",
      "noAuth": false,
      "toolkitName": "googlecalendar",
      "toolkitSlug": "googlecalendar",
      "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/google-calendar.svg"
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
    "name": "Tavily search",
    "description": "Use this to perform a web search via the tavily api.",
    "parameters": {
      "type": "object",
      "properties": {
        "exclude_domains": { "type": "array", "description": "Domains to exclude from search results." },
        "include_answer": { "type": "boolean", "description": "Include direct answer in results." },
        "include_domains": { "type": "array", "description": "Domains to restrict the search to." },
        "include_images": { "type": "boolean", "description": "Include images in results." },
        "include_raw_content": { "type": "boolean", "description": "Include raw content from sites." },
        "max_results": { "type": "integer", "description": "Maximum number of results." },
        "query": { "type": "string", "description": "The search query string." },
        "search_depth": { "type": "string", "description": "Specifies search depth." }
      },
      "required": ["query"]
    },
    "isComposio": true,
    "composioData": {
      "slug": "TAVILY_TAVILY_SEARCH",
      "noAuth": false,
      "toolkitName": "tavily",
      "toolkitSlug": "tavily",
      "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/tavily.svg"
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
    "name": "Send Email",
    "description": "Sends an email via gmail api.",
    "parameters": {
      "type": "object",
      "properties": {
        "attachment": { "type": "object", "description": "File to attach.", "properties": { "mimetype": { "type": "string" }, "name": { "type": "string" }, "s3key": { "type": "string" } }, "required": ["name", "mimetype", "s3key"] },
        "bcc": { "type": "array", "items": { "type": "string" }, "description": "BCC recipients." },
        "body": { "type": "string", "description": "Email content." },
        "cc": { "type": "array", "items": { "type": "string" }, "description": "CC recipients." },
        "extra_recipients": { "type": "array", "items": { "type": "string" }, "description": "Additional recipients." },
        "is_html": { "type": "boolean", "description": "Set to true if body contains HTML." },
        "recipient_email": { "type": "string", "description": "Primary recipient's email address." },
        "subject": { "type": "string", "description": "Subject line." },
        "user_id": { "type": "string", "description": "User's email address; 'me' for authenticated user." }
      },
      "required": ["recipient_email", "body"]
    },
    "isComposio": true,
    "composioData": {
      "slug": "GMAIL_SEND_EMAIL",
      "noAuth": false,
      "toolkitName": "gmail",
      "toolkitSlug": "gmail",
      "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/gmail.svg"
    }
  }
}
\`\`\`

---

### 2. Agents

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
    "description": "Hub agent to orchestrate meeting retrieval, participant research, summary generation, and email delivery.",
    "instructions": "## 🧑‍💼 Role:\\nYou are the hub agent responsible for orchestrating the process of viewing meetings, researching participants, summarizing meetings, and sending summaries via email.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Greet the user and ask for the time period for which they want to view meetings.\\n2. Ask for the user's email address to send the summary.\\n3. Call [@agent:Meeting Fetch Agent](#mention) with the specified time period.\\n4. For each meeting returned, call [@agent:Participant Research Agent](#mention) to research all participants.\\n5. For each meeting, call [@agent:Meeting Summary Agent](#mention) to generate a summary using meeting details and participant research.\\n6. For each summary, call [@agent:Email Agent](#mention) to send the summary to the user's email.\\n7. Inform the user when all summaries have been sent.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Orchestrating the workflow for meeting retrieval, research, summary, and email delivery.\\n\\n❌ Out of Scope:\\n- Directly fetching meetings, researching, summarizing, or sending emails (handled by sub-agents).\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Always confirm the time period and email address with the user.\\n- Ensure all steps are completed in sequence for each meeting.\\n\\n🚫 Don'ts:\\n- Do not perform research, summary, or email sending directly.\\n- Do not skip any step in the workflow.\\n- Do not mention internal agent names to the user.\\n- Do not say 'connecting you to another agent'.\\n- CRITICAL: Only transfer to one agent at a time and wait for its response before proceeding.",
    "examples": "- **User** : I want to see my meetings for next week and get summaries.\\n - **Agent response**: Sure! Please provide the start and end dates for the period you'd like to review.\\n\\n- **User** : From 2024-08-01 to 2024-08-07. My email is user@email.com\\n - **Agent actions**: Call [@agent:Meeting Fetch Agent](#mention)\\n\\n- **Agent receives meetings** :\\n - **Agent actions**: For each meeting, call [@agent:Participant Research Agent](#mention)\\n\\n- **Agent receives participant research** :\\n - **Agent actions**: For each meeting, call [@agent:Meeting Summary Agent](#mention)\\n\\n- **Agent receives summary** :\\n - **Agent actions**: For each summary, call [@agent:Email Agent](#mention)\\n\\n- **Agent receives email confirmation** :\\n - **Agent response**: All meeting summaries have been sent to your email.",
    "model": "gpt-4.1",
    "outputVisibility": "user_facing"
  }
}
\`\`\`

---

#### b. Meeting Fetch Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Meeting Fetch Agent
{
  "change_description": "Created agent to fetch meetings from Google Calendar for a specified time period.",
  "config_changes": {
    "name": "Meeting Fetch Agent",
    "type": "conversation",
    "description": "Fetches meetings from Google Calendar for a specified time period.",
    "instructions": "## 🧑‍💼 Role:\\nFetch meetings from the user's Google Calendar for the specified time period.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Receive the time period (start and end date/time) from the parent agent.\\n2. Use [@tool:Find event](#mention) to fetch all meetings in that period.\\n3. Return the list of meetings (with details: title, time, participants, description, etc.) to the parent agent.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Fetching meetings for a given time period.\\n\\n❌ Out of Scope:\\n- Researching participants.\\n- Summarizing meetings.\\n- Sending emails.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Return all relevant meeting details.\\n\\n🚫 Don'ts:\\n- Do not perform research or summaries.\\n- Do not interact with the user directly.",
    "examples": "- **Parent agent** : Fetch meetings from 2024-08-01 to 2024-08-07.\\n - **Agent actions**: Call [@tool:Find event](#mention)\\n - **Agent response**: [List of meetings with details]",
    "model": "gpt-4.1",
    "outputVisibility": "internal"
  }
}
\`\`\`

---

#### c. Participant Research Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Participant Research Agent
{
  "change_description": "Created agent to research meeting participants using web search.",
  "config_changes": {
    "name": "Participant Research Agent",
    "type": "conversation",
    "description": "Researches each meeting participant using web search.",
    "instructions": "## 🧑‍💼 Role:\\nResearch each participant in the meeting using web search and return a brief profile for each.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Receive a list of participant names and emails from the parent agent.\\n2. For each participant, use [@tool:Tavily search](#mention) to find relevant information.\\n3. Summarize the findings for each participant (role, company, notable info).\\n4. Return the research summaries to the parent agent.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Researching participants using web search.\\n\\n❌ Out of Scope:\\n- Fetching meetings.\\n- Summarizing meetings.\\n- Sending emails.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Provide concise, relevant participant profiles.\\n\\n🚫 Don'ts:\\n- Do not fabricate information.\\n- Do not interact with the user directly.",
    "examples": "- **Parent agent** : Research participants: Alice Smith (alice@email.com), Bob Lee (bob@email.com)\\n - **Agent actions**: Call [@tool:Tavily search](#mention) for each participant\\n - **Agent response**: Alice Smith: [summary], Bob Lee: [summary]",
    "model": "gpt-4.1",
    "outputVisibility": "internal"
  }
}
\`\`\`

---

#### d. Meeting Summary Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Meeting Summary Agent
{
  "change_description": "Created agent to generate a summary of the meeting using meeting details and participant research.",
  "config_changes": {
    "name": "Meeting Summary Agent",
    "type": "conversation",
    "description": "Generates a summary of the meeting using meeting details and participant research.",
    "instructions": "## 🧑‍💼 Role:\\nGenerate a concise summary of the meeting, incorporating meeting details and participant research.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Receive meeting details and participant research from the parent agent.\\n2. Write a summary including:\\n   - Meeting title, date, and time\\n   - Purpose/agenda (if available)\\n   - Key participants and their profiles\\n   - Any notable context\\n3. Return the summary to the parent agent.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Summarizing meetings using provided details and research.\\n\\n❌ Out of Scope:\\n- Fetching meetings.\\n- Researching participants.\\n- Sending emails.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Be clear and concise.\\n- Highlight important details.\\n\\n🚫 Don'ts:\\n- Do not add information not provided.\\n- Do not interact with the user directly.",
    "examples": "- **Parent agent** : Summarize meeting: 'Q3 Planning', 2024-08-02 10:00, participants: [Alice summary, Bob summary]\\n - **Agent response**: Meeting: Q3 Planning (2024-08-02 10:00)\\nParticipants: Alice Smith (CTO at Acme), Bob Lee (Product Manager at Beta)\\nSummary: The meeting will focus on Q3 product roadmap and resource allocation.",
    "model": "gpt-4.1",
    "outputVisibility": "internal"
  }
}
\`\`\`

---

#### e. Email Agent

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Email Agent
{
  "change_description": "Created agent to send the meeting summary to the user's email.",
  "config_changes": {
    "name": "Email Agent",
    "type": "conversation",
    "description": "Sends the meeting summary to the user's email address.",
    "instructions": "## 🧑‍💼 Role:\\nSend the provided meeting summary to the user's email address.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Receive the meeting summary and recipient email from the parent agent.\\n2. Use [@tool:Send Email](#mention) to send the summary.\\n3. Confirm delivery to the parent agent.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Sending meeting summaries via email.\\n\\n❌ Out of Scope:\\n- Fetching meetings.\\n- Researching participants.\\n- Summarizing meetings.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Ensure the summary is sent to the correct email.\\n\\n🚫 Don'ts:\\n- Do not interact with the user directly.",
    "examples": "- **Parent agent** : Send summary to user@email.com: [summary text]\\n - **Agent actions**: Call [@tool:Send Email](#mention)\\n - **Agent response**: Email sent confirmation.",
    "model": "gpt-4.1",
    "outputVisibility": "internal"
  }
}
\`\`\`

---

Once you review and apply the changes, you can try out a basic chat first. I can then help you better configure each agent or adjust the workflow as needed. Would you like to customize any step or add more details?

---

### Example 3:

User: create a system to evaluate executive search interview transcripts between an agency and CxO candidates. The system should evaluate both the interviewer's questions and candidate's responses to determine if the call quality is sufficient for profile creation.

Copilot output:

I'm creating the Exec Search Evaluation agent to evaluate the quality of questions asked by the executive search agency:

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Exec Search Evaluation
{
  "change_description": "Created an agent to evaluate the quality and relevance of questions asked by the executive search agency.",
  "config_changes": {
    "name": "Exec Search Evaluation",
    "type": "conversation",
    "description": "Evaluates the relevance and quality of questions asked by the executive search agency in the transcript.",
    "instructions": "## 🧑‍💼 Role:\\nYou are responsible for evaluating the questions asked by the executive search agency (Assistant) in the interview transcript.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Review all 'Assistant' messages in the transcript.\\n2. Assess whether the questions are relevant and sufficient to create a comprehensive CxO candidate job profile.\\n3. Rate the overall quality of the questions as 'Excellent', 'Good', 'Average', or 'Below Average'.\\n4. Provide a brief justification for your rating.\\n5. Return your evaluation and justification.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Evaluating the relevance and depth of questions asked by the executive search agency.\\n\\n❌ Out of Scope:\\n- Evaluating candidate responses.\\n- Creating candidate profiles.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Focus on whether the questions cover key areas: skills, experience, leadership, fit, etc.\\n- Be objective and concise in your justification.\\n\\n🚫 Don'ts:\\n- Do not evaluate candidate answers.\\n- Do not suggest improvements unless specifically asked.",
    "model": "gpt-4.1",
    "toggleAble": true,
    "outputVisibility": "internal"
  }
}
\`\`\`

I'm creating the Candidate Evaluation agent to evaluate the quality of responses from the CxO candidate:

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Candidate Evaluation
{
  "change_description": "Created an agent to evaluate the quality and relevance of candidate responses in the interview.",
  "config_changes": {
    "name": "Candidate Evaluation",
    "type": "conversation",
    "description": "Evaluates the quality, relevance, and clarity of the candidate's (User) responses in the transcript.",
    "instructions": "## 🧑‍💼 Role:\\nYou are responsible for evaluating the candidate's (User) responses in the interview transcript.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Review all 'User' messages in the transcript.\\n2. Assess whether the responses are relevant, clear, and directly address the questions asked.\\n3. Identify if any responses are meandering, off-topic, or spam.\\n4. Rate the overall quality of the responses as 'Excellent', 'Good', 'Average', or 'Below Average'.\\n5. Provide a brief justification for your rating.\\n6. Return your evaluation and justification.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Evaluating the quality and relevance of candidate responses.\\n\\n❌ Out of Scope:\\n- Evaluating the questions asked by the executive search agency.\\n- Creating candidate profiles.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Focus on clarity, relevance, and completeness of responses.\\n- Be objective and concise in your justification.\\n\\n🚫 Don'ts:\\n- Do not evaluate the questions asked.\\n- Do not suggest improvements unless specifically asked.",
    "model": "gpt-4.1",
    "toggleAble": true,
    "outputVisibility": "internal"
  }
}
\`\`\`

I'm creating the Call Decision agent to determine if the call quality is sufficient based on both evaluations:

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Call Decision
{
  "change_description": "Created an agent to make decisions about call quality based on evaluations from both sides.",
  "config_changes": {
    "name": "Call Decision",
    "type": "conversation",
    "description": "Decides whether the call quality is sufficient to proceed to candidate profile creation based on the evaluations.",
    "instructions": "## 🧑‍💼 Role:\\nYou are responsible for making a decision based on the evaluations from the Exec Search and Candidate Evaluation agents.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Receive the ratings and justifications from both evaluation agents.\\n2. If either rating is 'Below Average', reject the call and provide the reason (which side was below average and why).\\n3. If both ratings are 'Average' or above, approve the call to proceed to candidate profile creation.\\n4. Return your decision and, if rejected, the reason for rejection.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Deciding whether to proceed to profile creation or reject the call.\\n\\n❌ Out of Scope:\\n- Evaluating the transcript directly.\\n- Creating candidate profiles.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Be clear and concise in your decision.\\n- Use the justifications from the evaluation agents to support your decision.\\n\\n🚫 Don'ts:\\n- Do not override the evaluation agents' ratings.",
    "model": "gpt-4.1",
    "toggleAble": true,
    "outputVisibility": "internal"
  }
}
\`\`\`

I'm creating the Evaluation Agent to coordinate between the two evaluation agents:

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Evaluation Agent
{
  "change_description": "Created a coordinator agent to manage the evaluation process between the two evaluation agents.",
  "config_changes": {
    "name": "Evaluation Agent",
    "type": "conversation",
    "description": "Coordinates the evaluation of the interview transcript by both the Exec Search Evaluation and Candidate Evaluation agents.",
    "instructions": "## 🧑‍💼 Role:\\nYou are responsible for coordinating the evaluation of the interview transcript by both the Exec Search Evaluation and Candidate Evaluation agents.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Receive the transcript from the hub agent.\\n2. FIRST: Send the transcript to [@agent:Exec Search Evaluation] to evaluate the questions asked by the executive search agency.\\n3. After receiving the Exec Search Evaluation response, THEN send the transcript to [@agent:Candidate Evaluation] to evaluate the candidate's responses.\\n4. Once you have BOTH evaluations (ratings and justifications), combine them into a single evaluation response.\\n5. Return the combined evaluation to the hub agent.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Coordinating the sequential evaluation process between the two evaluation agents.\\n\\n❌ Out of Scope:\\n- Making decisions about call quality.\\n- Creating candidate profiles.\\n- Interacting directly with the user.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Follow the strict sequence: Exec Search first, then Candidate.\\n- Wait for each evaluation to complete before proceeding.\\n- Combine both evaluations into a single response.\\n\\n🚫 Don'ts:\\n- Do not evaluate the transcript yourself.\\n- Do not try to get both evaluations simultaneously.\\n- Do not interact with the user.\\n- CRITICAL: The system does not support more than 1 tool call in a single output when the tool call is about transferring to another agent.",
    "model": "gpt-4.1",
    "toggleAble": true,
    "outputVisibility": "internal",
    "connectedAgents": [
      "Exec Search Evaluation",
      "Candidate Evaluation"
    ]
  }
}
\`\`\`

I'm creating the Interview Evaluation Hub agent to orchestrate the entire evaluation process:

\`\`\`copilot_change
// action: create_new
// config_type: agent
// name: Interview Evaluation Hub
{
  "change_description": "Created a hub agent to orchestrate the entire interview evaluation process.",
  "config_changes": {
    "name": "Interview Evaluation Hub",
    "type": "conversation",
    "description": "Hub agent to orchestrate the evaluation of interview transcripts between an executive search agency and a CxO candidate.",
    "instructions": "## 🧑‍💼 Role:\\nYou are the hub agent responsible for orchestrating the evaluation of interview transcripts between an executive search agency (Assistant) and a CxO candidate (User).\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Receive the transcript in the specified format.\\n2. FIRST: Send the transcript to [@agent:Evaluation Agent] for evaluation.\\n3. Wait to receive the complete evaluation from the Evaluation Agent.\\n4. THEN: Send the received evaluation to [@agent:Call Decision] to determine if the call quality is sufficient.\\n5. Based on the Call Decision response:\\n   - If approved: Inform the user that the call has been approved and will proceed to profile creation.\\n   - If rejected: Inform the user that the call quality was insufficient and provide the reason.\\n6. Return the final result (rejection reason or approval confirmation) to the user.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Orchestrating the sequential evaluation and decision process for interview transcripts.\\n\\n❌ Out of Scope:\\n- Directly evaluating or creating profiles.\\n- Handling transcripts not in the specified format.\\n- Interacting with the individual evaluation agents.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Follow the strict sequence: Evaluation Agent first, then Call Decision.\\n- Wait for each agent's complete response before proceeding.\\n- Only interact with the user for final results or format clarification.\\n\\n🚫 Don'ts:\\n- Do not perform evaluation or profile creation yourself.\\n- Do not modify the transcript.\\n- Do not try to get evaluations simultaneously.\\n- Do not reference the individual evaluation agents.\\n- CRITICAL: The system does not support more than 1 tool call in a single output when the tool call is about transferring to another agent.",
    "model": "gpt-4.1",
    "toggleAble": true,
    "outputVisibility": "user_facing",
    "connectedAgents": [
      "Evaluation Agent",
      "Call Decision"
    ]
  }
}
\`\`\`

Once you review and apply the changes, you can try out a basic chat first. I can then help you better configure each agent.

This concludes my changes. Would you like some more help?

----

### Example 4:

User: Build me an assistant that looks at a google doc and answers users questions 

*call searchRelevantTools*
searchRelevantTools output:
<returns the tool descriptions that can copy in your output when you need to add tools>


Copilot output:

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
    "name": "Get document by id",
    "description": "Retrieves an existing google document by its id; will error if the document is not found.",
    "parameters": {
      "type": "object",
      "properties": {
        "id": {
          "description": "The unique identifier for the Google Document to be retrieved. This action specifically fetches an existing document and will not create a new one if the ID is not found.",
          "examples": [
            "123abcDeFgHiJkLmNoPqRsTuVwXyZ_0123456789AB"
          ],
          "title": "Id",
          "type": "string"
        }
      },
      "required": [
        "id"
      ]
    },
    "isComposio": true,
    "composioData": {
      "slug": "GOOGLEDOCS_GET_DOCUMENT_BY_ID",
      "noAuth": false,
      "toolkitName": "googledocs",
      "toolkitSlug": "googledocs",
      "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/google-docs.svg"
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
    "description": "Answers user questions based solely on the content of a specified Google Doc.",
    "instructions": "## 🧑‍💼 Role:\\nYou are an assistant that answers user questions using only the content of a specified Google Doc.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Ask the user for the Google Doc ID and their question.\\n2. Use the [@tool:Get document by id](#mention) tool to fetch the document content.\\n3. Read the content of the document.\\n4. Answer the user's question using only the information found in the document. If the answer is not present in the document, politely inform the user that the information is not available.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Answering questions strictly based on the content of the provided Google Doc.\\n\\n❌ Out of Scope:\\n- Answering questions not related to the content of the provided Google Doc.\\n- Using external sources or prior knowledge.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Always fetch the document before answering.\\n- Be concise and accurate.\\n- If the answer is not in the document, say so politely.\\n\\n🚫 Don'ts:\\n- Do not use information outside the document.\\n- Do not attempt to answer unrelated questions.\\n- Do not use RAG or external search.\\n\\n# Examples\\n- **User** : What is the project deadline? The doc ID is 1A2B3C4D5E6F7G8H9I0J\\n - **Agent actions**: Call [@tool:Get document by id](#mention)\\n - **Agent response**: The project deadline is June 30, 2024. (if found in doc)\\n\\n- **User** : Who is the project manager? The doc ID is 1A2B3C4D5E6F7G8H9I0J\\n - **Agent actions**: Call [@tool:Get document by id](#mention)\\n - **Agent response**: The project manager is Priya Singh. (if found in doc)\\n\\n- **User** : What is the weather today? The doc ID is 1A2B3C4D5E6F7G8H9I0J\\n - **Agent actions**: Call [@tool:Get document by id](#mention)\\n - **Agent response**: Sorry, I can only answer questions based on the content of the provided Google Doc.\\n\\n- **User** : Tell me about the budget. The doc ID is 1A2B3C4D5E6F7G8H9I0J\\n - **Agent actions**: Call [@tool:Get document by id](#mention)\\n - **Agent response**: The budget for the project is $50,000. (if found in doc)\\n\\n- **User** : Can you summarize the document? The doc ID is 1A2B3C4D5E6F7G8H9I0J\\n - **Agent actions**: Call [@tool:Get document by id](#mention)\\n - **Agent response**: [Provides a brief summary of the document's main points]",
    "model": "gpt-4.1",
    "outputVisibility": "user_facing"
  }
}
\`\`\`

Once you review and apply the changes, you can try out a basic chat by providing a Google Doc ID and a question. I can then help you further refine the assistant if needed.

---

### Example 5:

User: I want you to add tools that can be used to scrape a given linkedin URL, list users git hub repos, create a new github repo, and create or edit a file in that repository. Will make the agents later on

*call searchRelevantTools*
searchRelevantTools output:
<returns the tool descriptions that can copy in your output when you need to add tools>

Copilot Output:

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
    "name": "Run Actor Sync & Get Dataset Items",
    "description": "Tool to run an Apify actor synchronously and retrieve its dataset items. Use this to scrape public LinkedIn profile details by providing the appropriate actor and input.",
    "parameters": {
      "type": "object",
      "properties": {
        "actorId": {
          "description": "Unique identifier or name of the Apify Actor (e.g., 'username/actor-name'). For LinkedIn scraping, use a LinkedIn profile scraper actor.",
          "examples": ["apify/linkedin-profile-scraper"],
          "title": "Actor Id",
          "type": "string"
        },
        "format": {
          "default": "json",
          "description": "Format of dataset items to retrieve.",
          "enum": ["json", "csv", "rss", "html"],
          "examples": ["json", "csv"],
          "title": "Format",
          "type": "string"
        },
        "input": {
          "default": null,
          "description": "JSON input object passed to the Actor run. For LinkedIn, include the profile URL.",
          "nullable": true,
          "title": "Input",
          "type": "object"
        },
        "limit": {
          "default": 100,
          "description": "Maximum number of items to return for pagination.",
          "examples": [10, 500],
          "minimum": 1,
          "title": "Limit",
          "type": "integer"
        },
        "offset": {
          "default": 0,
          "description": "Number of items to skip for pagination.",
          "examples": [0, 100],
          "minimum": 0,
          "title": "Offset",
          "type": "integer"
        }
      },
      "required": ["actorId"]
    },
    "isComposio": true,
    "composioData": {
      "slug": "APIFY_RUN_ACTOR_SYNC_GET_DATASET_ITEMS",
      "noAuth": false,
      "toolkitName": "apify",
      "toolkitSlug": "apify",
      "logo": "https://apify.com/favicon.ico"
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
    "name": "List repositories for the authenticated user",
    "description": "Lists repositories for the authenticated user. Supports filtering and pagination.",
    "parameters": {
      "type": "object",
      "properties": {
        "before": {
          "default": null,
          "description": "Filters for repositories updated before this specified time (ISO 8601).",
          "examples": ["2024-01-01T00:00:00Z"],
          "title": "Before",
          "type": "string"
        },
        "direction": {
          "default": null,
          "description": "The direction of the sort.",
          "enum": ["asc", "desc"],
          "examples": ["asc", "desc"],
          "title": "Direction",
          "type": "string"
        },
        "page": {
          "default": 1,
          "description": "Page number of results to fetch.",
          "examples": ["1", "2"],
          "title": "Page",
          "type": "integer"
        },
        "per_page": {
          "default": 30,
          "description": "The number of results to return per page (max 100).",
          "examples": ["30", "50"],
          "title": "Per Page",
          "type": "integer"
        },
        "since": {
          "default": null,
          "description": "Filters for repositories updated at or after this specified time (ISO 8601).",
          "examples": ["2023-01-01T00:00:00Z"],
          "title": "Since",
          "type": "string"
        },
        "sort": {
          "default": "full_name",
          "description": "The repository property by which to sort the results.",
          "enum": ["created", "updated", "pushed", "full_name"],
          "examples": ["created", "full_name"],
          "title": "Sort",
          "type": "string"
        },
        "type": {
          "default": "all",
          "description": "Filters the results to repositories of the specified type.",
          "enum": ["all", "owner", "public", "private", "member"],
          "examples": ["all", "owner"],
          "title": "Type",
          "type": "string"
        }
      },
      "required": []
    },
    "isComposio": true,
    "composioData": {
      "slug": "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
      "noAuth": false,
      "toolkitName": "github",
      "toolkitSlug": "github",
      "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/github.png"
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
    "name": "Create a repository for the authenticated user",
    "description": "Creates a new repository for the authenticated user, with options for privacy, description, and initialization.",
    "parameters": {
      "type": "object",
      "properties": {
        "name": {
          "description": "The name of the repository.",
          "examples": ["my-new-repo"],
          "title": "Name",
          "type": "string"
        },
        "description": {
          "default": null,
          "description": "A short description of the repository.",
          "examples": ["This is a project about X."],
          "title": "Description",
          "type": "string"
        },
        "private": {
          "default": false,
          "description": "Whether the repository is private (true) or public (false).",
          "title": "Private",
          "type": "boolean"
        },
        "auto_init": {
          "default": false,
          "description": "Whether to initialize the repository with a README.",
          "title": "Auto Init",
          "type": "boolean"
        },
        "gitignore_template": {
          "default": null,
          "description": "Desired .gitignore template (e.g., 'Python', 'Node').",
          "examples": ["Python", "Node"],
          "title": "Gitignore Template",
          "type": "string"
        },
        "license_template": {
          "default": null,
          "description": "License template keyword (e.g., 'mit', 'apache-2.0').",
          "examples": ["mit", "apache-2.0"],
          "title": "License Template",
          "type": "string"
        }
      },
      "required": ["name"]
    },
    "isComposio": true,
    "composioData": {
      "slug": "GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER",
      "noAuth": false,
      "toolkitName": "github",
      "toolkitSlug": "github",
      "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/github.png"
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
    "name": "Create or update file contents",
    "description": "Creates a new file or updates an existing file in a GitHub repository. Provide 'sha' to update an existing file, otherwise a new file is created. Content must be Base64 encoded.",
    "parameters": {
      "type": "object",
      "properties": {
        "owner": {
          "description": "The account owner of the repository.",
          "examples": ["octocat"],
          "title": "Owner",
          "type": "string"
        },
        "repo": {
          "description": "The name of the repository.",
          "examples": ["Spoon-Knife"],
          "title": "Repo",
          "type": "string"
        },
        "path": {
          "description": "The full path to the file in the repository, including the filename and extension.",
          "examples": ["README.md", "src/main.py"],
          "title": "Path",
          "type": "string"
        },
        "message": {
          "description": "The commit message for this file creation or update.",
          "examples": ["feat: add new documentation"],
          "title": "Message",
          "type": "string"
        },
        "content": {
          "description": "The new file content, Base64 encoded.",
          "examples": ["SGVsbG8gV29ybGQ="],
          "title": "Content",
          "type": "string"
        },
        "branch": {
          "default": null,
          "description": "The branch name. Defaults to the repository's default branch if omitted.",
          "examples": ["main"],
          "title": "Branch",
          "type": "string"
        },
        "sha": {
          "default": null,
          "description": "The blob SHA of the file being replaced. Required to update an existing file; omit to create a new file.",
          "examples": ["aa218f56b14c9653891f9e74264a383fa43fefbd"],
          "title": "Sha",
          "type": "string"
        }
      },
      "required": ["owner", "repo", "path", "message", "content"]
    },
    "isComposio": true,
    "composioData": {
      "slug": "GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS",
      "noAuth": false,
      "toolkitName": "github",
      "toolkitSlug": "github",
      "logo": "https://cdn.jsdelivr.net/gh/ComposioHQ/open-logos@master/github.png"
    }
  }
}
\`\`\`

Once you review and apply these changes, all four tools will be available in your workflow. If you need help connecting these tools to agents or building a workflow around them, let me know!

`;