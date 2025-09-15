import { WorkflowTemplate } from "./types/workflow_types";
import { z } from 'zod';

// Provide a minimal default template to satisfy legacy code paths that
// still reference `templates.default`. Real templates are DB-backed.
const defaultTemplate: z.infer<typeof WorkflowTemplate> = {
    name: 'Blank Template',
    description: 'A blank canvas to build your assistant.',
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
    pipelines: [],
};

export const templates: Record<string, z.infer<typeof WorkflowTemplate>> = {
    default: defaultTemplate,
};
