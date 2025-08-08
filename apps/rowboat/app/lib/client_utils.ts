import { WorkflowTool, WorkflowAgent, WorkflowPrompt, WorkflowPipeline } from "./types/workflow_types";
import { z } from "zod";

export function validateConfigChanges(configType: string, configChanges: Record<string, unknown>, name: string) {
    let testObject: any;
    let schema: z.ZodType<any>;

    switch (configType) {
        case 'tool': {
            testObject = {
                name: 'test',
                description: 'test',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            } as z.infer<typeof WorkflowTool>;
            schema = WorkflowTool;
            break;
        }
        case 'agent': {
            // Check if this is a pipeline agent or task agent (internal) and use appropriate defaults
            const isPipelineAgent = configChanges.type === 'pipeline';
            const isTaskAgent = configChanges.outputVisibility === 'internal';
            const isInternalAgent = isPipelineAgent || isTaskAgent;
            
            testObject = {
                name: 'test',
                description: 'test',
                type: isPipelineAgent ? 'pipeline' : 'conversation',
                instructions: 'test',
                prompts: [],
                tools: [],
                model: 'gpt-4o',
                ragReturnType: 'chunks',
                ragK: 10,
                connectedAgents: [],
                controlType: isInternalAgent ? 'relinquish_to_parent' : 'retain',
                outputVisibility: isInternalAgent ? 'internal' : 'user_facing',
                maxCallsPerParentAgent: 3,
            } as z.infer<typeof WorkflowAgent>;
            schema = WorkflowAgent;
            break;
        }
        case 'prompt': {
            testObject = {
                name: 'test',
                type: 'base_prompt',
                prompt: "test",
            } as z.infer<typeof WorkflowPrompt>;
            schema = WorkflowPrompt;
            break;
        }
        case 'pipeline': {
            testObject = {
                name: 'test',
                description: 'test',
                agents: [],
            } as z.infer<typeof WorkflowPipeline>;
            schema = WorkflowPipeline;
            break;
        }
        default:
            return { error: `Unknown config type: ${configType}` };
    }

    // Validate each field and remove invalid ones
    const validatedChanges = { ...configChanges };
    for (const [key, value] of Object.entries(configChanges)) {
        const result = schema.safeParse({
            ...testObject,
            [key]: value,
        });
        if (!result.success) {
            console.log(`discarding field ${key} from ${configType}: ${name}`, result.error.message);
            delete validatedChanges[key];
        }
    }

    return { changes: validatedChanges };
}
