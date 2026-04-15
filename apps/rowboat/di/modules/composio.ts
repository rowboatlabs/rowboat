import { asClass } from "awilix";

import { MongodbComposioTriggerDeploymentsRepository } from "@/src/infrastructure/repositories/mongodb.composio-trigger-deployments.repository";
import { CreateComposioTriggerDeploymentUseCase } from "@/src/application/use-cases/composio-trigger-deployments/create-composio-trigger-deployment.use-case";
import { ListComposioTriggerDeploymentsUseCase } from "@/src/application/use-cases/composio-trigger-deployments/list-composio-trigger-deployments.use-case";
import { FetchComposioTriggerDeploymentUseCase } from "@/src/application/use-cases/composio-trigger-deployments/fetch-composio-trigger-deployment.use-case";
import { DeleteComposioTriggerDeploymentUseCase } from "@/src/application/use-cases/composio-trigger-deployments/delete-composio-trigger-deployment.use-case";
import { ListComposioTriggerTypesUseCase } from "@/src/application/use-cases/composio-trigger-deployments/list-composio-trigger-types.use-case";
import { HandleCompsioWebhookRequestUseCase } from "@/src/application/use-cases/composio/webhook/handle-composio-webhook-request.use-case";
import { CreateComposioTriggerDeploymentController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/create-composio-trigger-deployment.controller";
import { DeleteComposioTriggerDeploymentController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/delete-composio-trigger-deployment.controller";
import { ListComposioTriggerDeploymentsController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/list-composio-trigger-deployments.controller";
import { FetchComposioTriggerDeploymentController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/fetch-composio-trigger-deployment.controller";
import { ListComposioTriggerTypesController } from "@/src/interface-adapters/controllers/composio-trigger-deployments/list-composio-trigger-types.controller";
import { HandleComposioWebhookRequestController } from "@/src/interface-adapters/controllers/composio/webhook/handle-composio-webhook-request.controller";

export const composioRegistrations = {
    handleCompsioWebhookRequestUseCase: asClass(HandleCompsioWebhookRequestUseCase).singleton(),
    handleComposioWebhookRequestController: asClass(HandleComposioWebhookRequestController).singleton(),
    composioTriggerDeploymentsRepository: asClass(MongodbComposioTriggerDeploymentsRepository).singleton(),
    listComposioTriggerTypesUseCase: asClass(ListComposioTriggerTypesUseCase).singleton(),
    createComposioTriggerDeploymentUseCase: asClass(CreateComposioTriggerDeploymentUseCase).singleton(),
    listComposioTriggerDeploymentsUseCase: asClass(ListComposioTriggerDeploymentsUseCase).singleton(),
    fetchComposioTriggerDeploymentUseCase: asClass(FetchComposioTriggerDeploymentUseCase).singleton(),
    deleteComposioTriggerDeploymentUseCase: asClass(DeleteComposioTriggerDeploymentUseCase).singleton(),
    createComposioTriggerDeploymentController: asClass(CreateComposioTriggerDeploymentController).singleton(),
    deleteComposioTriggerDeploymentController: asClass(DeleteComposioTriggerDeploymentController).singleton(),
    listComposioTriggerDeploymentsController: asClass(ListComposioTriggerDeploymentsController).singleton(),
    fetchComposioTriggerDeploymentController: asClass(FetchComposioTriggerDeploymentController).singleton(),
    listComposioTriggerTypesController: asClass(ListComposioTriggerTypesController).singleton(),
};
