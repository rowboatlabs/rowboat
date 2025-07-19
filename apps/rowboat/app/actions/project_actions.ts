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
import { deleteMcpServerInstance, listActiveServerInstances } from "./klavis_actions";
import { authorizeUserAction } from "./billing_actions";
import { Workflow } from "../lib/types/workflow_types";
import { WorkflowTool } from "../lib/types/workflow_types";
import { collectProjectTools as libCollectProjectTools } from "../lib/project_tools";
import { 
    searchTools as libSearchTools,
    getToolsByIds as libGetToolsByIds,
    getTool as libGetTool,
    ZTool, 
    ZToolkit 
} from "../lib/composio/composio";

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
    const name = formData.get('name') as string;
    const templateKey = formData.get('template') as string;

    const { agents, prompts, tools, startAgent } = templates[templateKey];
    const response = await createBaseProject(name, user, {
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

export async function createProjectFromPrompt(formData: FormData): Promise<{ id: string } | { billingError: string }> {
    const user = await authCheck();
    const name = formData.get('name') as string;

    const { agents, prompts, tools, startAgent } = templates['default'];
    const response = await createBaseProject(name, user, {
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

async function detectAndAddComposioTools(projectId: string, workflow: z.infer<typeof Workflow>) {
    // Extract tool mentions from agent instructions
    const toolMentionPattern = /\[@tool:([^\]]+)\]\(#mention[^\)]*\)/g;
    const mentionedToolNames = new Set<string>();
    
    // Scan all agent instructions for tool mentions
    for (const agent of workflow.agents || []) {
        const instructions = agent.instructions || "";
        let match: RegExpExecArray | null;
        while ((match = toolMentionPattern.exec(instructions))) {
            mentionedToolNames.add(match[1]);
        }
    }
    
    if (mentionedToolNames.size === 0) {
        return; // No tool mentions found
    }
    
    console.log(`Found ${mentionedToolNames.size} tool mentions in workflow:`, Array.from(mentionedToolNames));
    
    // Search for these tools in Composio using the new efficient search methods
    const foundTools: z.infer<typeof ZTool>[] = [];
    
    try {
        // Method 1: Try to get tools directly by their exact slugs/names
        const mentionedToolNamesArray = Array.from(mentionedToolNames);
        
        try {
            const directToolsResponse = await libGetToolsByIds(mentionedToolNamesArray);
            foundTools.push(...directToolsResponse.items);
            console.log(`Found ${directToolsResponse.items.length} tools by direct lookup`);
        } catch (error) {
            console.log('Direct tool lookup failed, trying search approach');
        }
        
        // Method 2: For any remaining tools, use search functionality
        const foundToolSlugs = new Set(foundTools.map(tool => tool.slug));
        const foundToolNames = new Set(foundTools.map(tool => tool.name));
        const remainingToolNames = mentionedToolNamesArray.filter(name => 
            !foundToolSlugs.has(name) && !foundToolNames.has(name)
        );
        
        for (const toolName of remainingToolNames) {
            try {
                // Search for tools by name/description
                const searchResponse = await libSearchTools(toolName, null, 10);
                
                // Find exact matches by name or slug
                const exactMatches = searchResponse.items.filter(tool => 
                    tool.name === toolName || 
                    tool.slug === toolName ||
                    tool.name.toLowerCase() === toolName.toLowerCase() ||
                    tool.slug.toLowerCase() === toolName.toLowerCase()
                );
                
                if (exactMatches.length > 0) {
                    foundTools.push(...exactMatches);
                    console.log(`Found ${exactMatches.length} tools for search term "${toolName}"`);
                } else {
                    console.log(`No exact matches found for tool "${toolName}"`);
                }
            } catch (error) {
                console.error(`Error searching for tool "${toolName}":`, error);
            }
        }
        
    } catch (error) {
        console.error('Error searching for Composio tools:', error);
        return;
    }
    
    if (foundTools.length > 0) {
        console.log(`Adding ${foundTools.length} Composio tools to project ${projectId}`);
        
        // Remove duplicates based on slug
        const uniqueTools = foundTools.filter((tool, index, self) => 
            index === self.findIndex(t => t.slug === tool.slug)
        );
        
        // Add the found tools to the project
        await projectsCollection.updateOne(
            { _id: projectId },
            { $set: { composioSelectedTools: uniqueTools } }
        );
    } else {
        console.log('No matching Composio tools found for the mentioned tool names');
    }
}

export async function createProjectFromWorkflowJson(formData: FormData): Promise<{ id: string } | { billingError: string }> {
    const user = await authCheck();
    const workflowJson = formData.get('workflowJson') as string;
    let workflowData;
    try {
        workflowData = JSON.parse(workflowJson);
    } catch (e) {
        throw new Error('Invalid JSON');
    }
    // Validate and parse with zod
    const parsed = Workflow.safeParse(workflowData);
    if (!parsed.success) {
        throw new Error('Invalid workflow JSON: ' + JSON.stringify(parsed.error.issues));
    }
    const workflow = parsed.data;
    const name = 'Imported Project';
    const response = await createBaseProject(name, user, workflow);
    if ('billingError' in response) {
        return response;
    }
    const projectId = response.id;
    
    // Automatically detect and add Composio tools mentioned in agent instructions
    try {
        await detectAndAddComposioTools(projectId, workflow);
    } catch (error) {
        // Log error but don't fail the import if tool detection fails
        console.error('Failed to auto-detect Composio tools:', error);
    }
    
    return { id: projectId };
}

export async function collectProjectTools(projectId: string): Promise<z.infer<typeof WorkflowTool>[]> {
    await projectAuthCheck(projectId);
    return libCollectProjectTools(projectId);
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