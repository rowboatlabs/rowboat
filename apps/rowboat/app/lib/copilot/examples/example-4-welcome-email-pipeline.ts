export const EXAMPLE_4_WELCOME_EMAIL_PIPELINE = `
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
`;