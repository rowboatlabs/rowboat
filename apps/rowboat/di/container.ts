import { CreateRunUseCase } from "@/src/application/use-cases/runs/create-run.use-case";
import { RunsRepository } from "@/src/infrastructure/repositories/runs.repository.mongodb";
import { CreatePlaygroundChatRunController } from "@/src/interface-adapters/controllers/runs/create-playground-chat-run.controller";
import { asClass, createContainer, InjectionMode } from "awilix";

export const container = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true,
});

container.register({
    runsRepository: asClass(RunsRepository).singleton(),
    createRunUseCase: asClass(CreateRunUseCase).singleton(),
    createPlaygroundChatRunController: asClass(CreatePlaygroundChatRunController).singleton(),
});