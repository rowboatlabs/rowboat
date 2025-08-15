export const EXAMPLE_3_LINKEDIN_GITHUB_TOOLS = `
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
`;