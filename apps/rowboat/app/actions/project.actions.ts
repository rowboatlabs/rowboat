'use server';
import { z } from 'zod';
import { container } from "@/di/container";
import { redirect } from "next/navigation";
import { templates } from "../lib/project_templates";
import { authCheck } from "./auth.actions";
import { ApiKey } from "@/src/entities/models/api-key";
import { Project } from "@/src/entities/models/project";
import { USE_AUTH } from "../lib/feature_flags";
import { Workflow } from "../lib/types/workflow_types";
import { IProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { ICreateApiKeyController } from "@/src/interface-adapters/controllers/api-keys/create-api-key.controller";
import { IListApiKeysController } from "@/src/interface-adapters/controllers/api-keys/list-api-keys.controller";
import { IDeleteApiKeyController } from "@/src/interface-adapters/controllers/api-keys/delete-api-key.controller";
import { ICreateProjectController } from "@/src/interface-adapters/controllers/projects/create-project.controller";
import { BillingError } from "@/src/entities/errors/common";
import { IFetchProjectController } from "@/src/interface-adapters/controllers/projects/fetch-project.controller";
import { IListProjectsController } from "@/src/interface-adapters/controllers/projects/list-projects.controller";
import { IRotateSecretController } from "@/src/interface-adapters/controllers/projects/rotate-secret.controller";
import { IUpdateWebhookUrlController } from "@/src/interface-adapters/controllers/projects/update-webhook-url.controller";
import { IUpdateProjectNameController } from "@/src/interface-adapters/controllers/projects/update-project-name.controller";
import { IDeleteProjectController } from "@/src/interface-adapters/controllers/projects/delete-project.controller";
import { IUpdateDraftWorkflowController } from "@/src/interface-adapters/controllers/projects/update-draft-workflow.controller";
import { IUpdateLiveWorkflowController } from "@/src/interface-adapters/controllers/projects/update-live-workflow.controller";
import { IRevertToLiveWorkflowController } from "@/src/interface-adapters/controllers/projects/revert-to-live-workflow.controller";

const projectActionAuthorizationPolicy = container.resolve<IProjectActionAuthorizationPolicy>('projectActionAuthorizationPolicy');
const createApiKeyController = container.resolve<ICreateApiKeyController>('createApiKeyController');
const listApiKeysController = container.resolve<IListApiKeysController>('listApiKeysController');
const deleteApiKeyController = container.resolve<IDeleteApiKeyController>('deleteApiKeyController');
const createProjectController = container.resolve<ICreateProjectController>('createProjectController');
const fetchProjectController = container.resolve<IFetchProjectController>('fetchProjectController');
const listProjectsController = container.resolve<IListProjectsController>('listProjectsController');
const rotateSecretController = container.resolve<IRotateSecretController>('rotateSecretController');
const updateWebhookUrlController = container.resolve<IUpdateWebhookUrlController>('updateWebhookUrlController');
const updateProjectNameController = container.resolve<IUpdateProjectNameController>('updateProjectNameController');
const deleteProjectController = container.resolve<IDeleteProjectController>('deleteProjectController');
const updateDraftWorkflowController = container.resolve<IUpdateDraftWorkflowController>('updateDraftWorkflowController');
const updateLiveWorkflowController = container.resolve<IUpdateLiveWorkflowController>('updateLiveWorkflowController');
const revertToLiveWorkflowController = container.resolve<IRevertToLiveWorkflowController>('revertToLiveWorkflowController');

export async function listTemplates() {
    const templatesArray = Object.entries(templates)
        .filter(([key]) => key !== 'default') // Exclude the default template
        .map(([key, template]) => ({
            id: key,
            ...template
        }));
    
    return templatesArray;
}

export async function projectAuthCheck(projectId: string) {
    if (!USE_AUTH) {
        return;
    }
    const user = await authCheck();
    await projectActionAuthorizationPolicy.authorize({
        caller: 'user',
        userId: user._id,
        projectId,
    });
}

export async function createProject(formData: FormData): Promise<{ id: string } | { billingError: string }> {
    const user = await authCheck();
    const name = formData.get('name') as string | null;
    const templateKey = formData.get('template') as string | null;

    try {
        const project = await createProjectController.execute({
            userId: user._id,
            data: {
                name: name || '',
                mode: {
                    template: templateKey || 'default',
                },
            },
        });

        return { id: project.id };
    } catch (error) {
        if (error instanceof BillingError) {
            return { billingError: error.message };
        }
        throw error;
    }
}

export async function createProjectFromWorkflowJson(formData: FormData): Promise<{ id: string } | { billingError: string }> {
    const user = await authCheck();
    const name = formData.get('name') as string | null;
    const workflowJson = formData.get('workflowJson') as string;

    try {
        const project = await createProjectController.execute({
            userId: user._id,
            data: {
                name: name || '',
                mode: {
                    workflowJson,
                },
            },
        });

        return { id: project.id };
    } catch (error) {
        if (error instanceof BillingError) {
            return { billingError: error.message };
        }
        throw error;
    }
}

export async function fetchProject(projectId: string): Promise<z.infer<typeof Project>> {
    const user = await authCheck();
    const project = await fetchProjectController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
    });

    if (!project) {
        throw new Error('Project not found');
    }

    return project;
}

export async function listProjects(): Promise<z.infer<typeof Project>[]> {
    const user = await authCheck();

    const projects = [];
    let cursor = undefined;
    do {
        const result = await listProjectsController.execute({
            userId: user._id,
            cursor,
        });
        projects.push(...result.items);
        cursor = result.nextCursor;
    } while (cursor);

    return projects;
}

export async function rotateSecret(projectId: string): Promise<string> {
    const user = await authCheck();
    return await rotateSecretController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
    });
}

export async function updateWebhookUrl(projectId: string, url: string) {
    const user = await authCheck();
    await updateWebhookUrlController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        url,
    });
}

export async function createApiKey(projectId: string): Promise<z.infer<typeof ApiKey>> {
    const user = await authCheck();
    return await createApiKeyController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
    });
}

export async function deleteApiKey(projectId: string, id: string) {
    const user = await authCheck();
    return await deleteApiKeyController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        id,
    });
}

export async function listApiKeys(projectId: string): Promise<z.infer<typeof ApiKey>[]> {
    const user = await authCheck();
    return await listApiKeysController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
    });
}

export async function updateProjectName(projectId: string, name: string) {
    const user = await authCheck();
    await updateProjectNameController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        name,
    });
}

export async function deleteProject(projectId: string) {
    const user = await authCheck();
    await deleteProjectController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
    });

    redirect('/projects');
}

export async function saveWorkflow(projectId: string, workflow: z.infer<typeof Workflow>) {
    const user = await authCheck();
    await updateDraftWorkflowController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        workflow,
    });
}

export async function publishWorkflow(projectId: string, workflow: z.infer<typeof Workflow>) {
    const user = await authCheck();
    await updateLiveWorkflowController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
        workflow,
    });
}

export async function revertToLiveWorkflow(projectId: string) {
    const user = await authCheck();
    await revertToLiveWorkflowController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
    });
}