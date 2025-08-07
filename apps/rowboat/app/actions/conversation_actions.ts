"use server";

import { container } from "@/di/container";
import { IListConversationsController } from "@/src/interface-adapters/controllers/conversations/list-conversations.controller";
import { authCheck } from "./auth_actions";

const listConversationsController = container.resolve<IListConversationsController>('listConversationsController');

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