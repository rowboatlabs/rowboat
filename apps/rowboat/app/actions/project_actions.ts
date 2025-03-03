'use server';
import { redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { dataSourcesCollection, embeddingsCollection, projectsCollection, agentWorkflowsCollection, testScenariosCollection, projectMembersCollection, apiKeysCollection, dataSourceDocsCollection, testProfilesCollection } from "../lib/mongodb";
import { z } from 'zod';
import crypto from 'crypto';
import { revalidatePath } from "next/cache";
import { templates } from "../lib/project_templates";
import { authCheck } from "./actions";
import { WithStringId } from "../lib/types/types";
import { ApiKey } from "../lib/types/project_types";
import { Project } from "../lib/types/project_types";

export async function projectAuthCheck(projectId: string) {
    const user = await authCheck();
    const membership = await projectMembersCollection.findOne({
        projectId,
        userId: user.sub,
    });
    if (!membership) {
        throw new Error('User not a member of project');
    }
}
export async function createProject(formData: FormData) {
    const user = await authCheck();

    // ensure that projects created by this user is less than
    // configured limit
    const projectsLimit = Number(process.env.MAX_PROJECTS_PER_USER) || 0;
    if (projectsLimit > 0) {
        const count = await projectsCollection.countDocuments({
            createdByUserId: user.sub,
        });
        if (count >= projectsLimit) {
            throw new Error('You have reached your project limit. Please upgrade your plan.');
        }
    }

    const name = formData.get('name') as string;
    const templateKey = formData.get('template') as string;
    const projectId = crypto.randomUUID();
    const chatClientId = crypto.randomBytes(16).toString('base64url');
    const secret = crypto.randomBytes(32).toString('hex');
    const defaultTestProfileId = new ObjectId();

    // create project
    await projectsCollection.insertOne({
        _id: projectId,
        name: name,
        createdAt: (new Date()).toISOString(),
        lastUpdatedAt: (new Date()).toISOString(),
        createdByUserId: user.sub,
        chatClientId,
        secret,
        nextWorkflowNumber: 1,
        testRunCounter: 0,
        defaultTestProfileId: defaultTestProfileId.toString(),
    });

    // add first workflow version
    const { agents, prompts, tools, startAgent } = templates[templateKey];
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

    // add default test profile
    await testProfilesCollection.insertOne({
        _id: defaultTestProfileId,
        projectId,
        name: "Default",
        context: "",
        mockTools: false,
        createdAt: (new Date()).toISOString(),
        lastUpdatedAt: (new Date()).toISOString(),
    });

    // add user to project
    await projectMembersCollection.insertOne({
        userId: user.sub,
        projectId: projectId,
        createdAt: (new Date()).toISOString(),
        lastUpdatedAt: (new Date()).toISOString(),
    });

    redirect(`/projects/${projectId}/workflow`);
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
        userId: user.sub,
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
