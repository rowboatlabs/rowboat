import { WorkflowTemplate } from "./types/workflow_types";
import { z } from 'zod';
import { prebuiltTemplates } from './prebuilt-cards';

const DEFAULT_MODEL = process.env.PROVIDER_DEFAULT_MODEL || "gpt-4.1";

// Build templates object using static imports so Vercel bundles them
function buildTemplates(): { [key: string]: z.infer<typeof WorkflowTemplate> } {
    const templates: { [key: string]: z.infer<typeof WorkflowTemplate> } = {};

    // Add default template
    templates['default'] = {
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
                name: "Generate Image",
                description: "Generate an image using Google Gemini given a text prompt. Returns base64-encoded image data and any text parts.",
                isGeminiImage: true,
                parameters: {
                    type: 'object',
                    properties: {
                        prompt: { type: 'string', description: 'Text prompt describing the image to generate' },
                        modelName: { type: 'string', description: 'Optional Gemini model override' },
                    },
                    required: ['prompt'],
                    additionalProperties: true,
                },
            },
        ],
    };

    // Merge static prebuilt templates
    Object.entries(prebuiltTemplates).forEach(([key, tpl]) => {
        // Basic guard to avoid bad entries
        if ((tpl as any)?.agents && Array.isArray((tpl as any).agents)) {
            templates[key] = tpl as z.infer<typeof WorkflowTemplate>;
        }
    });

    return templates;
}

export const templates: { [key: string]: z.infer<typeof WorkflowTemplate> } = buildTemplates();

// Note: Prebuilt cards are now loaded from app/lib/prebuilt-cards/ directory
// starting_copilot_prompts has been removed as it was unused
