import { RunConversationTurnUseCase } from "@/src/application/use-cases/conversations/run-conversation-turn.use-case";
import { MongoDBConversationsRepository } from "@/src/infrastructure/repositories/mongodb.conversations.repository";
import { RunCachedTurnController } from "@/src/interface-adapters/controllers/conversations/run-cached-turn.controller";
import { asClass, createContainer, InjectionMode } from "awilix";
import { CreatePlaygroundConversationController } from "@/src/interface-adapters/controllers/conversations/create-playground-conversation.controller";
import { CreateConversationUseCase } from "@/src/application/use-cases/conversations/create-conversation.use-case";
import { RedisCacheService } from "@/src/infrastructure/services/redis.cache.service";
import { CreateCachedTurnUseCase } from "@/src/application/use-cases/conversations/create-cached-turn.use-case";
import { FetchCachedTurnUseCase } from "@/src/application/use-cases/conversations/fetch-cached-turn.use-case";
import { CreateCachedTurnController } from "@/src/interface-adapters/controllers/conversations/create-cached-turn.controller";

export const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
});

container.register({
    // services
    // ---
    cacheService: asClass(RedisCacheService).singleton(),

    // conversations
    // ---
    conversationsRepository: asClass(MongoDBConversationsRepository).singleton(),

    createConversationUseCase: asClass(CreateConversationUseCase).singleton(),
    createCachedTurnUseCase: asClass(CreateCachedTurnUseCase).singleton(),
    fetchCachedTurnUseCase: asClass(FetchCachedTurnUseCase).singleton(),
    runConversationTurnUseCase: asClass(RunConversationTurnUseCase).singleton(),

    createPlaygroundConversationController: asClass(CreatePlaygroundConversationController).singleton(),
    createCachedTurnController: asClass(CreateCachedTurnController).singleton(),
    runCachedTurnController: asClass(RunCachedTurnController).singleton(),
});