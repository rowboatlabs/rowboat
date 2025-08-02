import { CreateTurnUseCase } from "@/src/application/use-cases/runs/create-turn.use-case";
import { TurnsRepository } from "@/src/infrastructure/repositories/runs.repository.mongodb";
import { RedisPubSubService } from "@/src/infrastructure/services/pubsub.service.redis";
import { CreatePlaygroundChatTurnController } from "@/src/interface-adapters/controllers/turns/create-playground-chat-turn.controller";
import { asClass, createContainer, InjectionMode } from "awilix";

export const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
});

container.register({
    turnsRepository: asClass(TurnsRepository).singleton(),
    createTurnUseCase: asClass(CreateTurnUseCase).singleton(),
    createPlaygroundChatTurnController: asClass(CreatePlaygroundChatTurnController).singleton(),

    pubsubService: asClass(RedisPubSubService).singleton(),
});