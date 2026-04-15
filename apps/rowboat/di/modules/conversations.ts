import { asClass } from "awilix";

import { MongoDBConversationsRepository } from "@/src/infrastructure/repositories/mongodb.conversations.repository";
import { CreateConversationUseCase } from "@/src/application/use-cases/conversations/create-conversation.use-case";
import { CreateCachedTurnUseCase } from "@/src/application/use-cases/conversations/create-cached-turn.use-case";
import { FetchCachedTurnUseCase } from "@/src/application/use-cases/conversations/fetch-cached-turn.use-case";
import { RunConversationTurnUseCase } from "@/src/application/use-cases/conversations/run-conversation-turn.use-case";
import { ListConversationsUseCase } from "@/src/application/use-cases/conversations/list-conversations.use-case";
import { FetchConversationUseCase } from "@/src/application/use-cases/conversations/fetch-conversation.use-case";
import { CreatePlaygroundConversationController } from "@/src/interface-adapters/controllers/conversations/create-playground-conversation.controller";
import { CreateCachedTurnController } from "@/src/interface-adapters/controllers/conversations/create-cached-turn.controller";
import { RunCachedTurnController } from "@/src/interface-adapters/controllers/conversations/run-cached-turn.controller";
import { RunTurnController } from "@/src/interface-adapters/controllers/conversations/run-turn.controller";
import { ListConversationsController } from "@/src/interface-adapters/controllers/conversations/list-conversations.controller";
import { FetchConversationController } from "@/src/interface-adapters/controllers/conversations/fetch-conversation.controller";

export const conversationRegistrations = {
    conversationsRepository: asClass(MongoDBConversationsRepository).singleton(),
    createConversationUseCase: asClass(CreateConversationUseCase).singleton(),
    createCachedTurnUseCase: asClass(CreateCachedTurnUseCase).singleton(),
    fetchCachedTurnUseCase: asClass(FetchCachedTurnUseCase).singleton(),
    runConversationTurnUseCase: asClass(RunConversationTurnUseCase).singleton(),
    listConversationsUseCase: asClass(ListConversationsUseCase).singleton(),
    fetchConversationUseCase: asClass(FetchConversationUseCase).singleton(),
    createPlaygroundConversationController: asClass(CreatePlaygroundConversationController).singleton(),
    createCachedTurnController: asClass(CreateCachedTurnController).singleton(),
    runCachedTurnController: asClass(RunCachedTurnController).singleton(),
    runTurnController: asClass(RunTurnController).singleton(),
    listConversationsController: asClass(ListConversationsController).singleton(),
    fetchConversationController: asClass(FetchConversationController).singleton(),
};
