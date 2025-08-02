import { CreateTurnUseCase } from "@/src/application/use-cases/turns/create-turn.use-case";
import { ConversationsRepositoryMongodb } from "@/src/infrastructure/repositories/conversations.repository.mongodb";
import { TurnsRepositoryMongodb } from "@/src/infrastructure/repositories/turns.repository.mongodb";
import { RedisPubSubService } from "@/src/infrastructure/services/pubsub.service.redis";
import { CreatePlaygroundChatTurnController } from "@/src/interface-adapters/controllers/turns/create-playground-chat-turn.controller";
import { asClass, createContainer, InjectionMode } from "awilix";

export const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
});

container.register({
    conversationsRepository: asClass(ConversationsRepositoryMongodb).singleton(),

    turnsRepository: asClass(TurnsRepositoryMongodb).singleton(),
    createTurnUseCase: asClass(CreateTurnUseCase).singleton(),
    createPlaygroundChatTurnController: asClass(CreatePlaygroundChatTurnController).singleton(),

    pubsubService: asClass(RedisPubSubService).singleton(),
});