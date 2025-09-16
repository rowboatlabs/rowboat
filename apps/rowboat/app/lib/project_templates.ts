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
    tools: [],
    pipelines: [],
};

export const templates: Record<string, z.infer<typeof WorkflowTemplate>> = {
    default: defaultTemplate,
};
