import { z } from "zod";
import { Step, StepOutputT } from "../lib/step.js";
import { AgentTool } from "../entities/agent.js";

export class GetDate implements Step {
    async* execute(): StepOutputT {
        yield {
            type: "text-start",
        };
        yield {
            type: "text-delta",
            delta: 'The current date is ' + new Date().toISOString(),
        };
        yield {
            type: "text-end",
        };
    }

    tools(): Record<string, z.infer<typeof AgentTool>> {
        return {};
    }
}