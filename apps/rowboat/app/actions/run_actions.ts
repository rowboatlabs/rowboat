'use server';
import { z } from 'zod';
import { Workflow } from "../lib/types/workflow_types";
import { Message } from "@/app/lib/types/types";
import { authCheck } from './auth_actions';
import { container } from '@/di/container';
import { ICreatePlaygroundChatRunController } from '@/src/interface-adapters/controllers/runs/create-playground-chat-run.controller';
import { BillingError } from '@/src/entities/errors/common';
import { Run } from '@/src/entities/models/run';

export async function createPlaygroundChatRun(
    projectId: string,
    workflow: z.infer<typeof Workflow>,
    messages: z.infer<typeof Message>[],
): Promise<z.infer<typeof Run> | { billingError: string }> {
    const user = await authCheck();

    const controller = container.resolve<ICreatePlaygroundChatRunController>("createPlaygroundChatRunController");

    try {
        return await controller.execute({
            userId: user._id,
            projectId,
            messages,
            workflow,
            isLiveWorkflow: false,
        });
    } catch (err) {
        if (err instanceof BillingError) {
            return { billingError: err.message };
        }
        throw err;
    }
}