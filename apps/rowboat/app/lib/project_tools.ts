import { z } from "zod";
import { projectsCollection } from "./mongodb";
import { WorkflowTool } from "./types/workflow_types";

export async function fetchProjectMcpTools(projectId: string): Promise<z.infer<typeof WorkflowTool>[]> {
    // Get project's MCP servers and their tools
    const project = await projectsCollection.findOne({ _id: projectId });
    if (!project?.mcpServers) return [];

    console.log('[MCP] Getting tools from project:', {
        serverCount: project.mcpServers.length,
        servers: project.mcpServers.map(s => ({
            name: s.name,
            isReady: s.isReady,
            toolCount: s.tools.length,
            tools: s.tools.map(t => ({
                name: t.name,
                hasParams: !!t.parameters,
                paramCount: t.parameters ? Object.keys(t.parameters.properties).length : 0,
                required: t.parameters?.required || []
            }))
        }))
    });

    // Convert MCP tools to workflow tools format, but only from ready servers
    const mcpTools = project.mcpServers
        .filter(server => server.isReady) // Only include tools from ready servers
        .flatMap(server => {
            return server.tools.map(tool => ({
                name: tool.name,
                description: tool.description || "",
                parameters: {
                    type: 'object' as const,
                    properties: tool.parameters?.properties || {},
                    required: tool.parameters?.required || []
                },
                isMcp: true,
                mcpServerName: server.name,
                mcpServerURL: server.serverUrl,
            }));
        });

    console.log('[MCP] Converted tools from ready servers:', mcpTools.map(t => ({
        name: t.name,
        hasParams: !!t.parameters,
        paramCount: t.parameters ? Object.keys(t.parameters.properties).length : 0,
        required: t.parameters?.required || []
    })));

    return mcpTools;
}
