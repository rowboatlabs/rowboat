'use server';
import { z } from 'zod';
import { Workflow } from "../lib/types/workflow_types";
import { Message } from "@/app/lib/types/types";
import { authCheck } from './auth_actions';
import { container } from '@/di/container';
import { ICreatePlaygroundChatRunController } from '@/src/interface-adapters/controllers/runs/create-playground-chat-run.controller';
import { BillingError } from '@/src/entities/errors/common';

export async function getAssistantResponseStreamId(
    projectId: string,
    workflow: z.infer<typeof Workflow>,
    messages: z.infer<typeof Message>[],
): Promise<{ streamId: string } | { billingError: string }> {
    const user = await authCheck();

    const controller = container.resolve<ICreatePlaygroundChatRunController>("createPlaygroundChatRunController");

    try {
        const run = await controller.execute({
            userId: user._id,
            projectId,
            messages,
            workflow,
            isLiveWorkflow: false,
        });
        return { streamId: run.id };
    } catch (err) {
        if (err instanceof BillingError) {
            return { billingError: err.message };
        }
        throw err;
    }
}