import { CreateTurnUseCase } from "@/src/application/use-cases/turns/create-turn.use-case";
import { StreamTurnUseCase } from "@/src/application/use-cases/turns/stream-turn.use-case";
import { ConversationsRepositoryMongodb } from "@/src/infrastructure/repositories/conversations.repository.mongodb";
import { TurnsRepositoryMongodb } from "@/src/infrastructure/repositories/turns.repository.mongodb";
import { RedisPubSubService } from "@/src/infrastructure/services/pubsub.service.redis";
import { CreatePlaygroundChatTurnController } from "@/src/interface-adapters/controllers/turns/create-playground-chat-turn.controller";
import { StreamTurnController } from "@/src/interface-adapters/controllers/turns/stream-turn.controller";
import { asClass, createContainer, InjectionMode } from "awilix";

export const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
});

container.register({
    // conversations
    conversationsRepository: asClass(ConversationsRepositoryMongodb).singleton(),

    // turns
    turnsRepository: asClass(TurnsRepositoryMongodb).singleton(),
    createTurnUseCase: asClass(CreateTurnUseCase).singleton(),
    streamTurnUseCase: asClass(StreamTurnUseCase).singleton(),
    createPlaygroundChatTurnController: asClass(CreatePlaygroundChatTurnController).singleton(),
    streamTurnController: asClass(StreamTurnController).singleton(),

    pubsubService: asClass(RedisPubSubService).singleton(),
});