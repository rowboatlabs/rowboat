import { WorkflowTemplate } from "./types/workflow_types";
import { z } from 'zod';

const DEFAULT_MODEL = process.env.PROVIDER_DEFAULT_MODEL || "gpt-4.1";

export const templates: { [key: string]: z.infer<typeof WorkflowTemplate> } = {
    // Default template
    'default': {
        name: 'Blank Template',
        description: 'A blank canvas to build your agents.',
        startAgent: "Example Agent",
        agents: [
            {
                name: "Example Agent",
                type: "conversation",
                description: "An example agent",
                instructions: "## 🧑‍ Role:\nYou are an helpful customer support assistant\n\n---\n## ⚙️ Steps to Follow:\n1. Ask the user what they would like help with\n2. Ask the user for their email address and let them know someone will contact them soon.\n\n---\n## 🎯 Scope:\n✅ In Scope:\n- Asking the user their issue\n- Getting their email\n\n❌ Out of Scope:\n- Questions unrelated to customer support\n- If a question is out of scope, politely inform the user and avoid providing an answer.\n\n---\n## 📋 Guidelines:\n✔️ Dos:\n- ask user their issue\n\n❌ Don'ts:\n- don't ask user any other detail than email",
                model: DEFAULT_MODEL,
                toggleAble: true,
                ragReturnType: "chunks",
                ragK: 3,
                controlType: "retain",
                outputVisibility: "user_facing",
            },
        ],
        prompts: [],
        tools: [
            {
                "name": "rag_search",
                "description": "Fetch articles with knowledge relevant to the query",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The query to retrieve articles for"
                        }
                    },
                    "required": [
                        "query"
                    ]
                },
                "isLibrary": true
            }
        ],
        
    }
}

export const starting_copilot_prompts: { [key: string]: string } = {
    "Credit Card Assistant": "Create a credit card assistant that helps users with credit card related queries like card recommendations, benefits, rewards, application process, and general credit card advice. Provide accurate and helpful information while maintaining a professional and friendly tone.",

    "Scheduling Assistant": "Create an appointment scheduling assistant that helps users schedule, modify, and manage their appointments efficiently. Help with finding available time slots, sending reminders, rescheduling appointments, and answering questions about scheduling policies and procedures. Maintain a professional and organized approach.",

    "Blog Assistant": "Create a blog writer assistant with agents for researching, compiling, outlining and writing the blog. The research agent will research the topic and compile the information. The outline agent will write bullet points for the blog post. The writing agent will expand upon the outline and write the blog post. The blog post should be 1000 words or more.",
}