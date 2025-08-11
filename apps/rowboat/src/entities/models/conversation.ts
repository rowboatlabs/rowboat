import { z } from "zod";
import { Reason, Turn } from "./turn";
import { Workflow } from "@/app/lib/types/workflow_types";

export const Conversation = z.object({
    id: z.string(),
    projectId: z.string(),
    workflow: Workflow,
    reason: Reason,
    isLiveWorkflow: z.boolean(),
    turns: z.array(Turn).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime().optional(),
});