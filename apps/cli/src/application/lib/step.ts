import { MessageList } from "../entities/message.js";
import { LlmStepStreamEvent } from "../entities/llm-step-event.js";
import { z } from "zod";
import { AgentTool } from "../entities/agent.js";

export type StepInputT = z.infer<typeof MessageList>;
export type StepOutputT = AsyncGenerator<z.infer<typeof LlmStepStreamEvent>, void, unknown>;

export interface Step {
    execute(input: StepInputT): StepOutputT;

    tools(): Record<string, z.infer<typeof AgentTool>>;
}