'use server';
import { z } from 'zod';
import { Workflow } from "../lib/types/workflow_types";
import { Message } from "@/app/lib/types/types";
import { authCheck } from './auth_actions';
import { container } from '@/di/container';
import { ICreatePlaygroundChatTurnController } from '@/src/interface-adapters/controllers/turns/create-playground-chat-turn.controller';
import { BillingError } from '@/src/entities/errors/common';
import { Turn } from '@/src/entities/models/turn';

export async function createPlaygroundChatRun(
    projectId: string,
    workflow: z.infer<typeof Workflow>,
    messages: z.infer<typeof Message>[],
): Promise<z.infer<typeof Turn> | { billingError: string }> {
    const user = await authCheck();

    const controller = container.resolve<ICreatePlaygroundChatTurnController>("createPlaygroundChatTurnController");

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