import { asClass } from "awilix";

import { MongoDBApiKeysRepository } from "@/src/infrastructure/repositories/mongodb.api-keys.repository";
import { CreateApiKeyUseCase } from "@/src/application/use-cases/api-keys/create-api-key.use-case";
import { ListApiKeysUseCase } from "@/src/application/use-cases/api-keys/list-api-keys.use-case";
import { DeleteApiKeyUseCase } from "@/src/application/use-cases/api-keys/delete-api-key.use-case";
import { CreateApiKeyController } from "@/src/interface-adapters/controllers/api-keys/create-api-key.controller";
import { ListApiKeysController } from "@/src/interface-adapters/controllers/api-keys/list-api-keys.controller";
import { DeleteApiKeyController } from "@/src/interface-adapters/controllers/api-keys/delete-api-key.controller";

export const apiKeyRegistrations = {
    apiKeysRepository: asClass(MongoDBApiKeysRepository).singleton(),
    createApiKeyUseCase: asClass(CreateApiKeyUseCase).singleton(),
    listApiKeysUseCase: asClass(ListApiKeysUseCase).singleton(),
    deleteApiKeyUseCase: asClass(DeleteApiKeyUseCase).singleton(),
    createApiKeyController: asClass(CreateApiKeyController).singleton(),
    listApiKeysController: asClass(ListApiKeysController).singleton(),
    deleteApiKeyController: asClass(DeleteApiKeyController).singleton(),
};
