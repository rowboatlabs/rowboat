"use server";

import { container } from "@/di/container";
import { IListConversationsController } from "@/src/interface-adapters/controllers/conversations/list-conversations.controller";
import { IFetchConversationController } from "@/src/interface-adapters/controllers/conversations/fetch-conversation.controller";
import { authCheck } from "./auth_actions";

const listConversationsController = container.resolve<IListConversationsController>('listConversationsController');
const fetchConversationController = container.resolve<IFetchConversationController>('fetchConversationController');

export async function listConversations(request: {
    projectId: string,
    cursor?: string,
    limit?: number,
}) {
    const user = await authCheck();

    return await listConversationsController.execute({
        caller: 'user',
        userId: user._id,
        projectId: request.projectId,
        cursor: request.cursor,
        limit: request.limit,
    });
}

export async function fetchConversation(request: {
    conversationId: string,
}) {
    const user = await authCheck();

    return await fetchConversationController.execute({
        caller: 'user',
        userId: user._id,
        conversationId: request.conversationId,
    });
}