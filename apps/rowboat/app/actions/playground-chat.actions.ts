'use server';
import { z } from 'zod';
import { Workflow } from "../lib/types/workflow_types";
import { Message } from "@/app/lib/types/types";
import { authCheck } from './auth_actions';
import { container } from '@/di/container';
import { Conversation } from '@/src/entities/models/conversation';
import { ICreateConversationController } from '@/src/interface-adapters/controllers/conversations/create-conversation.controller';
import { ICreateCachedTurnController } from '@/src/interface-adapters/controllers/conversations/create-cached-turn.controller';

export async function createConversation({
    projectId,
}: {
    projectId: string;
}): Promise<z.infer<typeof Conversation>> {
    const user = await authCheck();

    const controller = container.resolve<ICreateConversationController>("createConversationController");

    return await controller.execute({
        caller: "user",
        userId: user._id,
        projectId,
    });
}

export async function createCachedTurn({
    conversationId,
    workflow,
    messages,
}: {
    conversationId: string;
    workflow: z.infer<typeof Workflow>;
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
            workflow,
        },
    });

    return {
        key,
    };
}