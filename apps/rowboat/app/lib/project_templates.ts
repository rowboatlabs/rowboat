import { WorkflowTemplate, WorkflowTool } from "./types/workflow_types";
import { z } from 'zod';

// Provide a minimal default template to satisfy legacy code paths that
// still reference `templates.default`. Real templates are DB-backed.
const tools: z.infer<typeof WorkflowTool>[] = [];

// Only include the image generation tool if GOOGLE_API_KEY is present
if (process.env.GOOGLE_API_KEY) {
    tools.push({
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
    });
}

const defaultTemplate: z.infer<typeof WorkflowTemplate> = {
    name: 'Blank Template',
    description: 'A blank canvas to build your assistant.',
    startAgent: "",
    agents: [],
    prompts: [],
    tools,
    pipelines: [],
};

export const templates: Record<string, z.infer<typeof WorkflowTemplate>> = {
    default: defaultTemplate,
};
