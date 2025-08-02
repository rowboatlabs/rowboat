import { z } from "zod";
import { Conversation } from "@/src/entities/models/conversation";

export const CreateConversationData = Conversation.pick({
    projectId: true,
});

export interface IConversationsRepository {
    // create a new conversation
    createConversation(data: z.infer<typeof CreateConversationData>): Promise<z.infer<typeof Conversation>>;

    // get conversation
    getConversation(id: string): Promise<z.infer<typeof Conversation> | null>;
}