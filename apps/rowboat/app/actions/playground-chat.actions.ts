'use server';
import { z } from 'zod';
import { Workflow } from "../lib/types/workflow_types";
import { Message, ZRunConversationTurnStreamPayload } from "@/app/lib/types/types";
import { authCheck } from './auth_actions';
import { container } from '@/di/container';
import { Conversation } from '@/src/entities/models/conversation';
import { ICreateConversationController } from '@/src/interface-adapters/controllers/conversations/create-conversation.controller';
import { redisClient } from '../lib/redis';

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

export async function createRunConversationTurnStreamId({
    conversationId,
    workflow,
    messages,
}: {
    conversationId: string;
    workflow: z.infer<typeof Workflow>;
    messages: z.infer<typeof Message>[];
}): Promise<{ streamId: string }> {
    const payload: z.infer<typeof ZRunConversationTurnStreamPayload> = {
        conversationId,
        workflow,
        messages,
    }

    // serialize the request
    const serialized = JSON.stringify(payload);

    // create a uuid for the stream
    const streamId = crypto.randomUUID();

    // store payload in redis
    await redisClient.set(`chat-stream-${streamId}`, serialized, 'EX', 60 * 10); // expire in 10 minutes

    return {
        streamId,
    }
}