import { RunConversationTurnUseCase } from "@/src/application/use-cases/conversations/run-conversation-turn.use-case";
import { ConversationsRepositoryMongodb } from "@/src/infrastructure/repositories/conversations.repository.mongodb";
import { RunPlaygroundChatTurnController } from "@/src/interface-adapters/controllers/conversations/run-playground-chat-turn.controller";
import { asClass, createContainer, InjectionMode } from "awilix";
import { CreateConversationController } from "@/src/interface-adapters/controllers/conversations/create-conversation.controller";
import { CreateConversationUseCase } from "@/src/application/use-cases/conversations/create-conversation.use-case";

export const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
});

container.register({
    // conversations
    conversationsRepository: asClass(ConversationsRepositoryMongodb).singleton(),
    createConversationUseCase: asClass(CreateConversationUseCase).singleton(),
    runConversationTurnUseCase: asClass(RunConversationTurnUseCase).singleton(),
    createConversationController: asClass(CreateConversationController).singleton(),
    runPlaygroundChatTurnController: asClass(RunPlaygroundChatTurnController).singleton(),
});