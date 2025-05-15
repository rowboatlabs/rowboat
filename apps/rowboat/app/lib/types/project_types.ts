import { z } from "zod";
import { MCPServer } from "./types";
import { WorkflowTool } from "./workflow_types";

export const Project = z.object({
    _id: z.string().uuid(),
    name: z.string(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
    createdByUserId: z.string(),
    secret: z.string(),
    chatClientId: z.string(),
    webhookUrl: z.string().optional(),
    publishedWorkflowId: z.string().optional(),
    nextWorkflowNumber: z.number().optional(),
    testRunCounter: z.number().default(0),
    mcpServers: z.array(MCPServer).optional(),
});

export const ProjectMember = z.object({
    userId: z.string(),
    projectId: z.string(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),
});

export const ApiKey = z.object({
    projectId: z.string(),
    key: z.string(),
    createdAt: z.string().datetime(),
    lastUsedAt: z.string().datetime().optional(),
});

export function mergeProjectTools(
    workflowTools: z.infer<typeof WorkflowTool>[],
    projectTools: z.infer<typeof WorkflowTool>[]
): z.infer<typeof WorkflowTool>[] {
    // Filter out any existing MCP tools from workflow tools
    const nonMcpTools = workflowTools.filter(t => !t.isMcp);

    // Merge with MCP tools
    const merged = [
        ...nonMcpTools,
        ...projectTools.map(tool => ({
            ...tool,
            isMcp: true as const, // Ensure isMcp is set
            parameters: {
                type: 'object' as const,
                properties: tool.parameters?.properties || {},
                required: tool.parameters?.required || []
            }
        }))
    ];

    console.log('[mergeMcpTools] Merged tools:', {
        totalCount: merged.length,
        nonMcpCount: nonMcpTools.length,
        mcpCount: projectTools.length,
        tools: merged.map(t => ({
            name: t.name,
            isMcp: t.isMcp,
            hasParams: !!t.parameters,
            paramCount: t.parameters ? Object.keys(t.parameters.properties).length : 0,
            parameters: t.parameters
        }))
    });

    return merged;
}
