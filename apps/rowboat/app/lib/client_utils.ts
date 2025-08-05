import { WorkflowTool, WorkflowAgent, WorkflowPrompt } from "./types/workflow_types";
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
            testObject = {
                name: 'test',
                description: 'test',
                type: 'conversation',
                instructions: 'test',
                prompts: [],
                tools: [],
                model: 'gpt-4o',
                ragReturnType: 'chunks',
                ragK: 10,
                connectedAgents: [],
                controlType: 'retain',
                outputVisibility: 'user_facing',
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
