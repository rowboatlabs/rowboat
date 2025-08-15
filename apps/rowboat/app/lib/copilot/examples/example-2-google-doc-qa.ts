export const EXAMPLE_2_GOOGLE_DOC_QA = `
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
    "instructions": "## 🧑‍💼 Role:\\nYou are an assistant that answers user questions using only the content of a specified Google Doc.\\n\\n---\\n## ⚙️ Steps to Follow:\\n1. Ask the user for the Google Doc ID and their question.\\n2. Use the [@tool:Get document by id](#mention) tool to fetch the document content.\\n3. Read the content of the document.\\n4. Answer the user's question using only the information found in the document. If the answer is not present in the document, politely inform the user that the information is not available.\\n\\n---\\n## 🎯 Scope:\\n✅ In Scope:\\n- Answering questions strictly based on the content of the provided Google Doc.\\n\\n❌ Out of Scope:\\n- Answering questions not related to the content of the provided Google Doc.\\n- Using external sources or prior knowledge.\\n\\n---\\n## 📋 Guidelines:\\n✔️ Dos:\\n- Always fetch the document before answering.\\n- Be concise and accurate.\\n- If the answer is not in the document, say so politely.\\n\\n🚫 Don'ts:\\n- Do not use information outside the document.\\n- Do not attempt to answer unrelated questions.\\n- Do not use RAG or external search.\\n\\n# Examples\\n- **User** : What is the project deadline? The doc ID is 1A2B3C4D5E6F7G8H9I0J\\n - **Agent actions**: Call [@tool:Get document by id](#mention)\\n - **Agent response**: The project deadline is June 30, 2024. (if found in doc)\\n\\n- **User** : Who is the project manager? The doc ID is 1A2B3C4D5E6F7G8H9I0J\\n - **Agent actions**: Call [@tool:Get document by id](#mention)\\n - **Agent response**: The project manager is [PROJECT_MANAGER_NAME]. (if found in doc)\\n\\n- **User** : What is the weather today? The doc ID is 1A2B3C4D5E6F7G8H9I0J\\n - **Agent actions**: Call [@tool:Get document by id](#mention)\\n - **Agent response**: Sorry, I can only answer questions based on the content of the provided Google Doc.\\n\\n- **User** : Tell me about the budget. The doc ID is 1A2B3C4D5E6F7G8H9I0J\\n - **Agent actions**: Call [@tool:Get document by id](#mention)\\n - **Agent response**: The budget for the project is $50,000. (if found in doc)\\n\\n- **User** : Can you summarize the document? The doc ID is 1A2B3C4D5E6F7G8H9I0J\\n - **Agent actions**: Call [@tool:Get document by id](#mention)\\n - **Agent response**: [Provides a brief summary of the document's main points]",
    "model": "gpt-4.1",
    "outputVisibility": "user_facing",
    "controlType": "retain"
  }
}
\`\`\`

Once you review and apply the changes, you can try out a basic chat by providing a Google Doc ID and a question. I can then help you further refine the assistant if needed.
`;