'use server';
import { ObjectId, WithId } from "mongodb";
import { projectsCollection, agentWorkflowsCollection } from "../lib/mongodb";
import { z } from 'zod';
import { templates } from "../lib/project_templates";
import { projectAuthCheck } from "./project_actions";
import { WithStringId } from "../lib/types/types";
import { Workflow } from "../lib/types/workflow_types";

export async function createWorkflow(projectId: string): Promise<WithStringId<z.infer<typeof Workflow>>> {
    await projectAuthCheck(projectId);

    // get the next workflow number
    const doc = await projectsCollection.findOneAndUpdate({
        _id: projectId,
    }, {
        $inc: {
            nextWorkflowNumber: 1,
        },
    }, {
        returnDocument: 'after'
    });
    if (!doc) {
        throw new Error('Project not found');
    }
    const nextWorkflowNumber = doc.nextWorkflowNumber;

    // create the workflow
    const template = templates['default'];
    if (!template) {
        throw new Error('Default template not found');
    }
    const { agents, prompts, tools, startAgent } = template;
    const workflow = {
        agents,
        prompts,
        tools,
        startAgent,
        projectId,
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        name: `Version ${nextWorkflowNumber}`,
    };
    const { insertedId } = await agentWorkflowsCollection.insertOne(workflow);
    const { _id, ...rest } = workflow as WithId<z.infer<typeof Workflow>>;
    return {
        ...rest,
        _id: insertedId.toString(),
    };
}

export async function cloneWorkflow(projectId: string, workflowId: string): Promise<WithStringId<z.infer<typeof Workflow>>> {
    await projectAuthCheck(projectId);
    const workflow = await agentWorkflowsCollection.findOne({
        _id: new ObjectId(workflowId),
        projectId,
    });
    if (!workflow) {
        throw new Error('Workflow not found');
    }

    // create a new workflow with the same content
    const newWorkflow = {
        ...workflow,
        _id: new ObjectId(),
        name: `Copy of ${workflow.name || 'Unnamed workflow'}`,
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
    };
    const { insertedId } = await agentWorkflowsCollection.insertOne(newWorkflow);
    const { _id, ...rest } = newWorkflow as WithId<z.infer<typeof Workflow>>;
    return {
        ...rest,
        _id: insertedId.toString(),
    };
}

export async function renameWorkflow(projectId: string, workflowId: string, name: string) {
    await projectAuthCheck(projectId);

    await agentWorkflowsCollection.updateOne({
        _id: new ObjectId(workflowId),
        projectId,
    }, {
        $set: {
            name,
            lastUpdatedAt: new Date().toISOString(),
        },
    });
}

export async function saveWorkflow(projectId: string, workflowId: string, workflow: z.infer<typeof Workflow>) {
    await projectAuthCheck(projectId);

    // check if workflow exists
    const existingWorkflow = await agentWorkflowsCollection.findOne({
        _id: new ObjectId(workflowId),
        projectId,
    });
    if (!existingWorkflow) {
        throw new Error('Workflow not found');
    }

    // ensure that this is not the published workflow for this project
    const publishedWorkflowId = await fetchPublishedWorkflowId(projectId);
    if (publishedWorkflowId && publishedWorkflowId === workflowId) {
        throw new Error('Cannot save published workflow');
    }

    // update the workflow, except name and description
    const { _id, name, ...rest } = workflow as WithId<z.infer<typeof Workflow>>;
    await agentWorkflowsCollection.updateOne({
        _id: new ObjectId(workflowId),
    }, {
        $set: {
            ...rest,
            lastUpdatedAt: new Date().toISOString(),
        },
    });
}

export async function publishWorkflow(projectId: string, workflowId: string) {
    await projectAuthCheck(projectId);

    // check if workflow exists
    const existingWorkflow = await agentWorkflowsCollection.findOne({
        _id: new ObjectId(workflowId),
        projectId,
    });
    if (!existingWorkflow) {
        throw new Error('Workflow not found');
    }

    // publish the workflow 
    await projectsCollection.updateOne({
        "_id": projectId,
    }, {
        $set: {
            publishedWorkflowId: workflowId,
        }
    });
}

export async function fetchPublishedWorkflowId(projectId: string): Promise<string | null> {
    await projectAuthCheck(projectId);
    const project = await projectsCollection.findOne({
        _id: projectId,
    });
    return project?.publishedWorkflowId || null;
}

export async function fetchWorkflow(projectId: string, workflowId: string): Promise<WithStringId<z.infer<typeof Workflow>>> {
    await projectAuthCheck(projectId);

    // fetch workflow
    const workflow = await agentWorkflowsCollection.findOne({
        _id: new ObjectId(workflowId),
        projectId,
    });
    if (!workflow) {
        throw new Error('Workflow not found');
    }
    const { _id, ...rest } = workflow;
    return {
        ...rest,
        _id: _id.toString(),
    };
}

export async function listWorkflows(
    projectId: string,
    page: number = 1,
    limit: number = 10
): Promise<{
    workflows: (WithStringId<z.infer<typeof Workflow>>)[];
    total: number;
    publishedWorkflowId: string | null;
}> {
    await projectAuthCheck(projectId);

    // fetch total count
    const total = await agentWorkflowsCollection.countDocuments({ projectId });

    // fetch published workflow
    let publishedWorkflowId: string | null = null;
    let publishedWorkflow: WithId<z.infer<typeof Workflow>> | null = null;
    if (page === 1) {
        publishedWorkflowId = await fetchPublishedWorkflowId(projectId);
        if (publishedWorkflowId) {
            publishedWorkflow = await agentWorkflowsCollection.findOne({
                _id: new ObjectId(publishedWorkflowId),
                projectId,
            }, {
                projection: {
                    _id: 1,
                    name: 1,
                    description: 1,
                    createdAt: 1,
                    lastUpdatedAt: 1,
                },
            });
        }
    }

    // fetch workflows with pagination
    let workflows: WithId<z.infer<typeof Workflow>>[] = await agentWorkflowsCollection.find(
        {
            projectId,
            ...(publishedWorkflowId ? {
                _id: {
                    $ne: new ObjectId(publishedWorkflowId)
                }
            } : {}),
        },
        {
            sort: { lastUpdatedAt: -1 },
            projection: {
                _id: 1,
                name: 1,
                description: 1,
                createdAt: 1,
                lastUpdatedAt: 1,
            },
            skip: (page - 1) * limit,
            limit: limit,
        }
    ).toArray();
    workflows = [
        ...(publishedWorkflow ? [publishedWorkflow] : []),
        ...workflows,
    ];

    // return workflows
    return {
        workflows: workflows.map((w) => {
            const { _id, ...rest } = w;
            return {
                ...rest,
                _id: _id.toString(),
            };
        }),
        total,
        publishedWorkflowId,
    };
}