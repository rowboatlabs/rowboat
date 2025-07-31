import { Message } from "@/app/lib/types/types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { z } from "zod";

export const Run = z.object({
    id: z.string(),
    createdAt: z.date(),
    trigger: z.enum([
        "chat",
        "api",
    ]),
    triggerData: z.object({
        messages: z.array(Message),
    }),
    projectId: z.string(),
    workflow: Workflow,
    isLiveWorkflow: z.boolean(),
    messages: z.array(Message),
    status: z.enum([
        "pending",
        "running",
        "completed",
        "failed",
    ]),
    error: z.string().optional(),
    lastUpdatedAt: z.date().optional(),
});

export const UpdateRunData = Run.pick({
    messages: true,
    status: true,
    error: true,
});