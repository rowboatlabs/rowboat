'use server';
import { redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { db, dataSourcesCollection, embeddingsCollection, projectsCollection, projectMembersCollection, apiKeysCollection, dataSourceDocsCollection } from "../lib/mongodb";
import { z } from 'zod';
import crypto from 'crypto';
import { revalidatePath } from "next/cache";
import { templates } from "../lib/project_templates";
import { authCheck } from "./auth_actions";
import { User, WithStringId } from "../lib/types/types";
import { ApiKey } from "../lib/types/project_types";
import { Project } from "../lib/types/project_types";
import { USE_AUTH } from "../lib/feature_flags";
import { authorizeUserAction } from "./billing_actions";
import { Workflow } from "../lib/types/workflow_types";
import { container } from "@/di/container";
import { IProjectActionAuthorizationPolicy } from "@/src/application/policies/project-action-authorization.policy";

const KLAVIS_API_KEY = process.env.KLAVIS_API_KEY || '';

const projectActionAuthorizationPolicy = container.resolve<IProjectActionAuthorizationPolicy>('projectActionAuthorizationPolicy');

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

async function createBaseProject(
    name: string,
    user: WithStringId<z.infer<typeof User>>,
    workflow?: z.infer<typeof Workflow>
): Promise<{ id: string } | { billingError: string }> {
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

    // choose a fallback name
    if (!name) {
        name = `Assistant ${projectCount + 1}`;
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
        draftWorkflow: workflow,
        liveWorkflow: workflow,
        chatClientId,
        secret,
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
    const name = formData.get('name') as string | null;
    const templateKey = formData.get('template') as string | null;

    const { agents, prompts, tools, startAgent } = templates[templateKey || 'default'];
    const response = await createBaseProject(name || '', user, {
        agents,
        prompts,
        tools,
        startAgent,
        lastUpdatedAt: (new Date()).toISOString(),
    });
    if ('billingError' in response) {
        return response;
    }

    const projectId = response.id;
    return { id: projectId };
}

export async function createProjectFromWorkflowJson(formData: FormData): Promise<{ id: string } | { billingError: string }> {
    const user = await authCheck();
    const name = formData.get('name') as string | null;

    const workflowJson = formData.get('workflowJson') as string;
    const { agents, prompts, tools, pipelines, startAgent } = Workflow.parse(JSON.parse(workflowJson));
    const response = await createBaseProject(name || 'Imported project', user, {
        agents,
        prompts,
        tools,
        pipelines,
        startAgent,
        lastUpdatedAt: (new Date()).toISOString(),
    });
    if ('billingError' in response) {
        return response;
    }

    const projectId = response.id;
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

export async function deleteProject(projectId: string) {
    await projectAuthCheck(projectId);

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

    const project = await getProjectConfig(projectId);
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