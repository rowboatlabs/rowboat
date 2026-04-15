import { asClass } from "awilix";

import { MongodbProjectsRepository } from "@/src/infrastructure/repositories/mongodb.projects.repository";
import { MongoDBProjectMembersRepository } from "@/src/infrastructure/repositories/mongodb.project-members.repository";
import { CreateProjectUseCase } from "@/src/application/use-cases/projects/create-project.use-case";
import { DeleteComposioConnectedAccountUseCase } from "@/src/application/use-cases/projects/delete-composio-connected-account.use-case";
import { CreateComposioManagedConnectedAccountUseCase } from "@/src/application/use-cases/projects/create-composio-managed-connected-account.use-case";
import { CreateCustomConnectedAccountUseCase } from "@/src/application/use-cases/projects/create-custom-connected-account.use-case";
import { SyncConnectedAccountUseCase } from "@/src/application/use-cases/projects/sync-connected-account.use-case";
import { ListComposioToolkitsUseCase } from "@/src/application/use-cases/projects/list-composio-toolkits.use-case";
import { GetComposioToolkitUseCase } from "@/src/application/use-cases/projects/get-composio-toolkit.use-case";
import { ListComposioToolsUseCase } from "@/src/application/use-cases/projects/list-composio-tools.use-case";
import { AddCustomMcpServerUseCase } from "@/src/application/use-cases/projects/add-custom-mcp-server.use-case";
import { RemoveCustomMcpServerUseCase } from "@/src/application/use-cases/projects/remove-custom-mcp-server.use-case";
import { DeleteProjectUseCase } from "@/src/application/use-cases/projects/delete-project.use-case";
import { ListProjectsUseCase } from "@/src/application/use-cases/projects/list-projects.use-case";
import { FetchProjectUseCase } from "@/src/application/use-cases/projects/fetch-project.use-case";
import { RotateSecretUseCase } from "@/src/application/use-cases/projects/rotate-secret.use-case";
import { UpdateWebhookUrlUseCase } from "@/src/application/use-cases/projects/update-webhook-url.use-case";
import { UpdateProjectNameUseCase } from "@/src/application/use-cases/projects/update-project-name.use-case";
import { UpdateDraftWorkflowUseCase } from "@/src/application/use-cases/projects/update-draft-workflow.use-case";
import { UpdateLiveWorkflowUseCase } from "@/src/application/use-cases/projects/update-live-workflow.use-case";
import { RevertToLiveWorkflowUseCase } from "@/src/application/use-cases/projects/revert-to-live-workflow.use-case";
import { CreateProjectController } from "@/src/interface-adapters/controllers/projects/create-project.controller";
import { DeleteComposioConnectedAccountController } from "@/src/interface-adapters/controllers/projects/delete-composio-connected-account.controller";
import { CreateComposioManagedConnectedAccountController } from "@/src/interface-adapters/controllers/projects/create-composio-managed-connected-account.controller";
import { CreateCustomConnectedAccountController } from "@/src/interface-adapters/controllers/projects/create-custom-connected-account.controller";
import { SyncConnectedAccountController } from "@/src/interface-adapters/controllers/projects/sync-connected-account.controller";
import { ListComposioToolkitsController } from "@/src/interface-adapters/controllers/projects/list-composio-toolkits.controller";
import { GetComposioToolkitController } from "@/src/interface-adapters/controllers/projects/get-composio-toolkit.controller";
import { ListComposioToolsController } from "@/src/interface-adapters/controllers/projects/list-composio-tools.controller";
import { AddCustomMcpServerController } from "@/src/interface-adapters/controllers/projects/add-custom-mcp-server.controller";
import { RemoveCustomMcpServerController } from "@/src/interface-adapters/controllers/projects/remove-custom-mcp-server.controller";
import { DeleteProjectController } from "@/src/interface-adapters/controllers/projects/delete-project.controller";
import { ListProjectsController } from "@/src/interface-adapters/controllers/projects/list-projects.controller";
import { FetchProjectController } from "@/src/interface-adapters/controllers/projects/fetch-project.controller";
import { RotateSecretController } from "@/src/interface-adapters/controllers/projects/rotate-secret.controller";
import { UpdateWebhookUrlController } from "@/src/interface-adapters/controllers/projects/update-webhook-url.controller";
import { UpdateProjectNameController } from "@/src/interface-adapters/controllers/projects/update-project-name.controller";
import { UpdateDraftWorkflowController } from "@/src/interface-adapters/controllers/projects/update-draft-workflow.controller";
import { UpdateLiveWorkflowController } from "@/src/interface-adapters/controllers/projects/update-live-workflow.controller";
import { RevertToLiveWorkflowController } from "@/src/interface-adapters/controllers/projects/revert-to-live-workflow.controller";

export const projectRegistrations = {
    projectsRepository: asClass(MongodbProjectsRepository).singleton(),
    projectMembersRepository: asClass(MongoDBProjectMembersRepository).singleton(),
    createProjectUseCase: asClass(CreateProjectUseCase).singleton(),
    createProjectController: asClass(CreateProjectController).singleton(),
    fetchProjectUseCase: asClass(FetchProjectUseCase).singleton(),
    fetchProjectController: asClass(FetchProjectController).singleton(),
    listProjectsUseCase: asClass(ListProjectsUseCase).singleton(),
    listProjectsController: asClass(ListProjectsController).singleton(),
    rotateSecretUseCase: asClass(RotateSecretUseCase).singleton(),
    rotateSecretController: asClass(RotateSecretController).singleton(),
    updateWebhookUrlUseCase: asClass(UpdateWebhookUrlUseCase).singleton(),
    updateWebhookUrlController: asClass(UpdateWebhookUrlController).singleton(),
    updateProjectNameUseCase: asClass(UpdateProjectNameUseCase).singleton(),
    updateProjectNameController: asClass(UpdateProjectNameController).singleton(),
    updateDraftWorkflowUseCase: asClass(UpdateDraftWorkflowUseCase).singleton(),
    updateDraftWorkflowController: asClass(UpdateDraftWorkflowController).singleton(),
    updateLiveWorkflowUseCase: asClass(UpdateLiveWorkflowUseCase).singleton(),
    updateLiveWorkflowController: asClass(UpdateLiveWorkflowController).singleton(),
    revertToLiveWorkflowUseCase: asClass(RevertToLiveWorkflowUseCase).singleton(),
    revertToLiveWorkflowController: asClass(RevertToLiveWorkflowController).singleton(),
    deleteProjectUseCase: asClass(DeleteProjectUseCase).singleton(),
    deleteProjectController: asClass(DeleteProjectController).singleton(),
    deleteComposioConnectedAccountController: asClass(DeleteComposioConnectedAccountController).singleton(),
    deleteComposioConnectedAccountUseCase: asClass(DeleteComposioConnectedAccountUseCase).singleton(),
    createComposioManagedConnectedAccountUseCase: asClass(CreateComposioManagedConnectedAccountUseCase).singleton(),
    createComposioManagedConnectedAccountController: asClass(CreateComposioManagedConnectedAccountController).singleton(),
    createCustomConnectedAccountUseCase: asClass(CreateCustomConnectedAccountUseCase).singleton(),
    createCustomConnectedAccountController: asClass(CreateCustomConnectedAccountController).singleton(),
    syncConnectedAccountUseCase: asClass(SyncConnectedAccountUseCase).singleton(),
    syncConnectedAccountController: asClass(SyncConnectedAccountController).singleton(),
    listComposioToolkitsUseCase: asClass(ListComposioToolkitsUseCase).singleton(),
    listComposioToolkitsController: asClass(ListComposioToolkitsController).singleton(),
    getComposioToolkitUseCase: asClass(GetComposioToolkitUseCase).singleton(),
    getComposioToolkitController: asClass(GetComposioToolkitController).singleton(),
    listComposioToolsUseCase: asClass(ListComposioToolsUseCase).singleton(),
    listComposioToolsController: asClass(ListComposioToolsController).singleton(),
    addCustomMcpServerUseCase: asClass(AddCustomMcpServerUseCase).singleton(),
    addCustomMcpServerController: asClass(AddCustomMcpServerController).singleton(),
    removeCustomMcpServerUseCase: asClass(RemoveCustomMcpServerUseCase).singleton(),
    removeCustomMcpServerController: asClass(RemoveCustomMcpServerController).singleton(),
};
