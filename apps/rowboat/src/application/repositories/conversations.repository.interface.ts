import { z } from "zod";
import { Conversation } from "@/src/entities/models/conversation";
import { Turn } from "@/src/entities/models/turn";
import { PaginatedList } from "@/src/entities/common/paginated-list";

export const CreateConversationData = Conversation.pick({
    projectId: true,
    workflow: true,
    isLiveWorkflow: true,
});

export const AddTurnData = Turn.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export interface IConversationsRepository {
    // create a new conversation
    create(data: z.infer<typeof CreateConversationData>): Promise<z.infer<typeof Conversation>>;

    // get conversation
    fetch(id: string): Promise<z.infer<typeof Conversation> | null>;

    // list conversations for project
    list(projectId: string, cursor?: string, limit?: number): Promise<z.infer<ReturnType<typeof PaginatedList<typeof Conversation>>>>;

    // add turn data to conversation
    // returns the created turn
    addTurn(conversationId: string, data: z.infer<typeof AddTurnData>): Promise<z.infer<typeof Turn>>;
}