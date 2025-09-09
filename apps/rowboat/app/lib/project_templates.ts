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
        startAgent: "",
        agents: [],
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
