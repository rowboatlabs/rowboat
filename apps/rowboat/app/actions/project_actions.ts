'use server';
import { redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { dataSourcesCollection, embeddingsCollection, projectsCollection, agentWorkflowsCollection, testScenariosCollection, projectMembersCollection, apiKeysCollection, dataSourceDocsCollection, testProfilesCollection } from "../lib/mongodb";
import { z } from 'zod';
import crypto from 'crypto';
import { revalidatePath } from "next/cache";
import { templates } from "../lib/project_templates";
import { authCheck } from "./auth_actions";
import { User, WithStringId } from "../lib/types/types";
import { ApiKey } from "../lib/types/project_types";
import { Project } from "../lib/types/project_types";
import { USE_AUTH } from "../lib/feature_flags";
import { deleteMcpServerInstance, listActiveServerInstances } from "./klavis_actions";
import { authorizeUserAction } from "./billing_actions";

const KLAVIS_API_KEY = process.env.KLAVIS_API_KEY || '';

export async function projectAuthCheck(projectId: string) {
    if (!USE_AUTH) {
        return;
    }
    const user = await authCheck();
    const membership = await projectMembersCollection.findOne({
        projectId,
        userId: user._id,
    });
    if (!membership) {
        throw new Error('User not a member of project');
    }
}

async function createBaseProject(name: string, user: WithStringId<z.infer<typeof User>>): Promise<{ id: string } | { billingError: string }> {
    // fetch project count for this user
    const projectCount = await projectsCollection.countDocuments({
        createdByUserId: user._id,
    });
    // billing limit check
    const authResponse = await authorizeUserAction({
        type: 'create_project',
        data: {
            existingProjectCount: projectCount,
        },
    });
    if (!authResponse.success) {
        return { billingError: authResponse.error || 'Billing error' };
    }

    const projectId = crypto.randomUUID();
    const chatClientId = crypto.randomBytes(16).toString('base64url');
    const secret = crypto.randomBytes(32).toString('hex');

    // Create project
    await projectsCollection.insertOne({
        _id: projectId,
        name,
        createdAt: (new Date()).toISOString(),
        lastUpdatedAt: (new Date()).toISOString(),
        createdByUserId: user._id,
        chatClientId,
        secret,
        nextWorkflowNumber: 1,
        testRunCounter: 0,
    });

    // Add user to project
    await projectMembersCollection.insertOne({
        userId: user._id,
        projectId: projectId,
        createdAt: (new Date()).toISOString(),
        lastUpdatedAt: (new Date()).toISOString(),
    });

    // Add first api key
    await createApiKey(projectId);

    return { id: projectId };
}

export async function createProject(formData: FormData): Promise<{ id: string } | { billingError: string }> {
    const user = await authCheck();
    const name = formData.get('name') as string;
    const templateKey = formData.get('template') as string;

    const response = await createBaseProject(name, user);
    if ('billingError' in response) {
        return response;
    }

    const projectId = response.id;

    // Add first workflow version with specified template
    const template = templates[templateKey];
    if (!template) {
        throw new Error(`Template ${templateKey} not found`);
    }
    const { agents, prompts, tools, startAgent } = template;
    await agentWorkflowsCollection.insertOne({
        projectId,
        agents,
        prompts,
        tools,
        startAgent,
        createdAt: (new Date()).toISOString(),
        lastUpdatedAt: (new Date()).toISOString(),
        name: `Version 1`,
    });

    return { id: projectId };
}

export async function getProjectConfig(projectId: string): Promise<WithStringId<z.infer<typeof Project>>> {
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
    const memberships = await projectMembersCollection.find({
        userId: user._id,
    }).toArray();
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

export async function createApiKey(projectId: string): Promise<WithStringId<z.infer<typeof ApiKey>>> {
    await projectAuthCheck(projectId);

    // count existing keys
    const count = await apiKeysCollection.countDocuments({ projectId });
    if (count >= 3) {
        throw new Error('Maximum number of API keys reached');
    }

    // create key
    const key = crypto.randomBytes(32).toString('hex');
    const doc: z.infer<typeof ApiKey> = {
        projectId,
        key,
        createdAt: new Date().toISOString(),
    };
    await apiKeysCollection.insertOne(doc);
    const { _id, ...rest } = doc as WithStringId<z.infer<typeof ApiKey>>;
    return { ...rest, _id: _id.toString() };
}

export async function deleteApiKey(projectId: string, id: string) {
    await projectAuthCheck(projectId);
    await apiKeysCollection.deleteOne({ projectId, _id: new ObjectId(id) });
}

export async function listApiKeys(projectId: string): Promise<WithStringId<z.infer<typeof ApiKey>>[]> {
    await projectAuthCheck(projectId);
    const keys = await apiKeysCollection.find({ projectId }).toArray();
    return keys.map(k => ({ ...k, _id: k._id.toString() }));
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

async function cleanupMcpServers(projectId: string): Promise<McpServerDeletionError[]> {
    // Get all active instances directly from Klavis
    const activeInstances = await listActiveServerInstances(projectId);
    if (activeInstances.length === 0) return [];

    console.log(`[Project Cleanup] Found ${activeInstances.length} active Klavis instances`);

    // Track deletion errors
    const deletionErrors: McpServerDeletionError[] = [];

    // Delete each instance
    const deletionPromises = activeInstances.map(async (instance) => {
        if (!instance.id) return; // Skip if no instance ID

        try {
            await deleteMcpServerInstance(instance.id, projectId);
            console.log(`[Project Cleanup] Deleted Klavis instance: ${instance.name} (${instance.id})`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[Project Cleanup] Failed to delete Klavis instance: ${instance.name}`, error);
            deletionErrors.push({
                serverName: instance.name,
                error: errorMessage
            });
        }
    });

    // Wait for all deletions to complete
    await Promise.all(deletionPromises);

    return deletionErrors;
}

export async function deleteProject(projectId: string) {
    await projectAuthCheck(projectId);

    // First cleanup any Klavis instances
    if (KLAVIS_API_KEY) {
        const deletionErrors = await cleanupMcpServers(projectId);

        // If there were any errors deleting instances, throw an error
        if (deletionErrors.length > 0) {
            const failedServers = deletionErrors.map(e => `${e.serverName} (${e.error})`).join(', ');
            throw new Error(`Cannot delete project because the following Klavis instances could not be deleted: ${failedServers}. Please try again or contact support if the issue persists.`);
        }
    }

    // delete api keys
    await apiKeysCollection.deleteMany({
        projectId,
    });

    // delete embeddings
    const sources = await dataSourcesCollection.find({
        projectId,
    }, {
        projection: {
            _id: true,
        }
    }).toArray();

    const ids = sources.map(s => s._id);

    // delete data sources
    await embeddingsCollection.deleteMany({
        sourceId: { $in: ids.map(i => i.toString()) },
    });
    await dataSourcesCollection.deleteMany({
        _id: {
            $in: ids,
        }
    });

    // delete project members
    await projectMembersCollection.deleteMany({
        projectId,
    });

    // delete workflows
    await agentWorkflowsCollection.deleteMany({
        projectId,
    });

    // delete scenarios
    await testScenariosCollection.deleteMany({
        projectId,
    });

    // delete project
    await projectsCollection.deleteOne({
        _id: projectId,
    });

    redirect('/projects');
}

export async function createProjectFromPrompt(formData: FormData): Promise<{ id: string } | { billingError: string }> {
    const user = await authCheck();
    const name = formData.get('name') as string;

    const response = await createBaseProject(name, user);
    if ('billingError' in response) {
        return response;
    }

    const projectId = response.id;

    // Add first workflow version with default template
    const template = templates['default'];
    if (!template) {
        throw new Error('Default template not found');
    }
    const { agents, prompts, tools, startAgent } = template;
    await agentWorkflowsCollection.insertOne({
        projectId,
        agents,
        prompts,
        tools,
        startAgent,
        createdAt: (new Date()).toISOString(),
        lastUpdatedAt: (new Date()).toISOString(),
        name: `Version 1`,
    });

    return { id: projectId };
}
