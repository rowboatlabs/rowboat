'use server';
import { z } from 'zod';
import { Workflow } from "../lib/types/workflow_types";
import { Message } from "@/app/lib/types/types";
import { authCheck } from './auth_actions';
import { container } from '@/di/container';
import { Conversation } from '@/src/entities/models/conversation';
import { ICreatePlaygroundConversationController } from '@/src/interface-adapters/controllers/conversations/create-playground-conversation.controller';
import { ICreateCachedTurnController } from '@/src/interface-adapters/controllers/conversations/create-cached-turn.controller';

export async function createConversation({
    projectId,
    workflow,
    isLiveWorkflow,
}: {
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    isLiveWorkflow: boolean;
}): Promise<z.infer<typeof Conversation>> {
    const user = await authCheck();

    const controller = container.resolve<ICreatePlaygroundConversationController>("createPlaygroundConversationController");

    return await controller.execute({
        userId: user._id,
        projectId,
        workflow,
        isLiveWorkflow,
    });
}

export async function createCachedTurn({
    conversationId,
    messages,
}: {
    conversationId: string;
    messages: z.infer<typeof Message>[];
}): Promise<{ key: string }> {
    const user = await authCheck();
    const createCachedTurnController = container.resolve<ICreateCachedTurnController>("createCachedTurnController");

    const { key } = await createCachedTurnController.execute({
        caller: "user",
        userId: user._id,
        conversationId,
        input: {
            messages,
        },
    });

    return {
        key,
    };
}