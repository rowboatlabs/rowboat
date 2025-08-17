'use server';
import { redirect } from "next/navigation";
import { db, projectsCollection } from "../lib/mongodb";
import { z } from 'zod';
import crypto from 'crypto';
import { revalidatePath } from "next/cache";
import { templates } from "../lib/project_templates";
import { authCheck } from "./auth.actions";
import { User, WithStringId } from "../lib/types/types";
import { ApiKey } from "@/src/entities/models/api-key";
import { Project } from "@/src/entities/models/project";
import { USE_AUTH } from "../lib/feature_flags";
import { authorizeUserAction } from "./billing.actions";
import { Workflow } from "../lib/types/workflow_types";
import { IProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";
import { ICreateApiKeyController } from "@/src/interface-adapters/controllers/api-keys/create-api-key.controller";
import { IListApiKeysController } from "@/src/interface-adapters/controllers/api-keys/list-api-keys.controller";
import { IDeleteApiKeyController } from "@/src/interface-adapters/controllers/api-keys/delete-api-key.controller";
import { IApiKeysRepository } from "@/src/application/repositories/api-keys.repository.interface";
import { IProjectMembersRepository } from "@/src/application/repositories/project-members.repository.interface";
import { IDataSourcesRepository } from "@/src/application/repositories/data-sources.repository.interface";
import { IDataSourceDocsRepository } from "@/src/application/repositories/data-source-docs.repository.interface";
import { container } from "@/di/container";
import { qdrantClient } from "../lib/qdrant";
import { ICreateProjectController } from "@/src/interface-adapters/controllers/projects/create-project.controller";
import { BillingError } from "@/src/entities/errors/common";

const projectActionAuthorizationPolicy = container.resolve<IProjectActionAuthorizationPolicy>('projectActionAuthorizationPolicy');
const createApiKeyController = container.resolve<ICreateApiKeyController>('createApiKeyController');
const listApiKeysController = container.resolve<IListApiKeysController>('listApiKeysController');
const deleteApiKeyController = container.resolve<IDeleteApiKeyController>('deleteApiKeyController');
const apiKeysRepository = container.resolve<IApiKeysRepository>('apiKeysRepository');
const projectMembersRepository = container.resolve<IProjectMembersRepository>('projectMembersRepository');
const dataSourcesRepository = container.resolve<IDataSourcesRepository>('dataSourcesRepository');
const dataSourceDocsRepository = container.resolve<IDataSourceDocsRepository>('dataSourceDocsRepository');
const createProjectController = container.resolve<ICreateProjectController>('createProjectController');

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
    await projectAuthCheck(projectId);
    const project = await projectsCollection.findOne({
        _id: projectId,
    });
    if (!project) {
        throw new Error('Project config not found');
    }
    return project;
}

export async function listProjects(): Promise<z.infer<typeof Project>[]> {
    const user = await authCheck();
    const memberships = [];
    let cursor = undefined;
    do {
        const result = await projectMembersRepository.findByUserId(user._id, cursor);
        memberships.push(...result.items);
        cursor = result.nextCursor;
    } while (cursor);
    const projectIds = memberships.map((m) => m.projectId);
    const projects = await projectsCollection.find({
        _id: { $in: projectIds },
    }).toArray();
    return projects;
}

export async function rotateSecret(projectId: string): Promise<string> {
    await projectAuthCheck(projectId);
    const secret = crypto.randomBytes(32).toString('hex');
    await projectsCollection.updateOne(
        { _id: projectId },
        { $set: { secret } }
    );
    return secret;
}

export async function updateWebhookUrl(projectId: string, url: string) {
    await projectAuthCheck(projectId);
    await projectsCollection.updateOne(
        { _id: projectId },
        { $set: { webhookUrl: url } }
    );
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
    await projectAuthCheck(projectId);
    await projectsCollection.updateOne({ _id: projectId }, { $set: { name } });
    revalidatePath(`/projects/${projectId}`, 'layout');
}

interface McpServerDeletionError {
    serverName: string;
    error: string;
}

export async function deleteProject(projectId: string) {
    await projectAuthCheck(projectId);

    // delete api keys
    await apiKeysRepository.deleteAll(projectId);

    // delete data sources data
    await dataSourceDocsRepository.deleteByProjectId(projectId);
    await dataSourcesRepository.deleteByProjectId(projectId);
    await qdrantClient.delete("embeddings", {
        filter: {
            must: [
                { key: "projectId", match: { value: projectId } },
            ],
        },
    });

    // delete project members
    await projectMembersRepository.deleteByProjectId(projectId);

    // delete workflow versions
    await db.collection('agent_workflows').deleteMany({
        projectId,
    });

    // delete scenarios
    await db.collection('test_scenarios').deleteMany({
        projectId,
    });

    // delete project
    await projectsCollection.deleteOne({
        _id: projectId,
    });

    redirect('/projects');
}

export async function saveWorkflow(projectId: string, workflow: z.infer<typeof Workflow>) {
    await projectAuthCheck(projectId);

    // update the project's draft workflow
    workflow.lastUpdatedAt = new Date().toISOString();
    await projectsCollection.updateOne({
        _id: projectId,
    }, {
        $set: {
            draftWorkflow: workflow,
        },
    });
}

export async function publishWorkflow(projectId: string, workflow: z.infer<typeof Workflow>) {
    await projectAuthCheck(projectId);

    // update the project's draft workflow
    workflow.lastUpdatedAt = new Date().toISOString();
    await projectsCollection.updateOne({
        _id: projectId,
    }, {
        $set: {
            liveWorkflow: workflow,
        },
    });
}

export async function revertToLiveWorkflow(projectId: string) {
    await projectAuthCheck(projectId);

    const project = await fetchProject(projectId);
    const workflow = project.liveWorkflow;

    if (!workflow) {
        throw new Error('No live workflow found');
    }

    workflow.lastUpdatedAt = new Date().toISOString();
    await projectsCollection.updateOne({
        _id: projectId,
    }, {
        $set: {
            draftWorkflow: workflow,
        },
    });
}