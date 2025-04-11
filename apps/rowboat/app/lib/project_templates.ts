import { WorkflowTemplate } from "./types/workflow_types";
import { z } from 'zod';

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
                instructions: `## 🧑‍ Role:
You are an helpful customer support assistant

---
## ⚙️ Steps to Follow:
1. Ask the user what they would like help with
2. Ask the user for their email address and let them know someone will contact them soon.

---
## 🎯 Scope:
✅ In Scope:
- Asking the user their issue
- Getting their email

❌ Out of Scope:
- Questions unrelated to customer support
- If a question is out of scope, politely inform the user and avoid providing an answer.

---
## 📋 Guidelines:
✔️ Dos:
- ask user their issue

❌ Don'ts:
- don't ask user any other detail than email`,
                model: "gpt-4o",
                toggleAble: true,
                ragReturnType: "chunks",
                ragK: 3,
                controlType: "retain",
            },
        ],
        prompts: [
            {
                name: "Style prompt",
                type: "style_prompt",
                prompt: "You should be empathetic and helpful.",
            },
            {
                name: "Greeting",
                type: "greeting",
                prompt: "Hello! How can I help you?"
            }
        ],
        tools: [
            {
                "name": "web_search",
                "description": "Fetch information from the web based on chat context",
                "type": "library",
                "parameters": {
                    "type": "object",
                    "properties": {},
                },
                "implementation": "default",
            }
        ],
    }
}

export const starting_copilot_prompts: { [key: string]: string } = {
    "Credit Card Assistant": "Create a credit card assistant that helps users with credit card related queries like card recommendations, benefits, rewards, application process, and general credit card advice. Provide accurate and helpful information while maintaining a professional and friendly tone.",

    "Scheduling Assistant": "Create an appointment scheduling assistant that helps users schedule, modify, and manage their appointments efficiently. Help with finding available time slots, sending reminders, rescheduling appointments, and answering questions about scheduling policies and procedures. Maintain a professional and organized approach.",

    "Banking Assistant": "Create a banking assistant focused on helping customers with their banking needs. Help with account inquiries, banking products and services, transaction information, and general banking guidance. Prioritize accuracy and security while providing clear and helpful responses to banking-related questions."
}