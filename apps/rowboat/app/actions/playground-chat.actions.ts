'use server';
import { z } from 'zod';
import { Workflow } from "../lib/types/workflow_types";
import { Message } from "@/app/lib/types/types";
import { authCheck } from './auth_actions';
import { container } from '@/di/container';
import { BillingError } from '@/src/entities/errors/common';
import { Turn } from '@/src/entities/models/turn';
import { Conversation } from '@/src/entities/models/conversation';
import { ICreateConversationController } from '@/src/interface-adapters/controllers/conversations/create-conversation.controller';
import { IRunPlaygroundChatTurnController } from '@/src/interface-adapters/controllers/conversations/run-playground-chat-turn.controller';
import { projectAuthCheck } from './project_actions';
import { getAgenticResponseStreamId } from '../lib/utils';

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
    projectId,
    conversationId,
    workflow,
    messages,
}: {
    projectId: string;
    conversationId?: string;
    workflow: z.infer<typeof Workflow>;
    messages: z.infer<typeof Message>[];
}): Promise<z.infer<typeof Turn> | { billingError: string }> {
    await projectAuthCheck(projectId);

    const { streamId } = await getAgenticResponseStreamId(projectId, workflow, messages);

    return {
        streamId,
    };
}