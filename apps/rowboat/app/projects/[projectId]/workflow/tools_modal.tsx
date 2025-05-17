"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, Spinner, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Checkbox } from "@heroui/react";
import { z } from "zod";
import { WorkflowTool } from "@/app/lib/types/workflow_types";
import { RefreshCwIcon, SearchIcon, ServerIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { fetchMcpTools } from "@/app/actions/mcp_actions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ServerLogo } from "../../../projects/[projectId]/tools/components/HostedTools";
import { listAvailableMcpServers, McpServer } from "@/app/actions/klavis_actions";
import clsx from "clsx";

interface ToolsModalProps {
    projectId: string;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onImport: (tools: z.infer<typeof WorkflowTool>[]) => void;
    onConfigureWebhook: () => void;
    webhookUrl?: string;
}

export function ToolsModal({ 
    projectId, 
    isOpen, 
    onOpenChange, 
    onImport,
    onConfigureWebhook,
    webhookUrl 
}: ToolsModalProps) {
    const [activeTab, setActiveTab] = useState('hosted');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tools, setTools] = useState<z.infer<typeof WorkflowTool>[]>([]);
    const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [hostedServers, setHostedServers] = useState<McpServer[]>([]);
    const [loadingHosted, setLoadingHosted] = useState(false);
    const [hostedError, setHostedError] = useState<string | null>(null);
    const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());

    // Fetch hosted servers
    const fetchHostedServers = useCallback(async () => {
        setLoadingHosted(true);
        setHostedError(null);
        try {
            const response = await listAvailableMcpServers(projectId);
            if (response.error) {
                throw new Error(response.error);
            }
            if (!response.data) {
                throw new Error('No data received from server');
            }
            // Only show active servers
            setHostedServers(response.data.filter(server => server.isActive));
        } catch (error: any) {
            setHostedError(error.message || 'Failed to load hosted servers');
            setHostedServers([]);
        } finally {
            setLoadingHosted(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (isOpen && activeTab === 'hosted') {
            fetchHostedServers();
        }
    }, [isOpen, activeTab, fetchHostedServers]);

    const process = useCallback(async () => {
        setLoading(true);
        setError(null);
        setSelectedTools(new Set());
        try {
            const result = await fetchMcpTools(projectId);
            setTools(result);
            // Select all tools by default
            setSelectedTools(new Set(result.map((_, index) => index.toString())));
        } catch (error) {
            setError(`Unable to fetch tools: ${error}`);
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        if (isOpen && activeTab === 'custom') {
            process();
        }
    }, [isOpen, activeTab, process]);

    // Group hosted tools by server and filter based on search
    const groupedHostedTools = hostedServers.reduce((acc, server) => {
        // Only include tools from servers that either don't need auth or are authenticated
        if ((!server.authNeeded || server.isAuthenticated)) {
            const serverTools = server.tools.filter(tool => {
                const matchesSearch = 
                    tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    server.serverName.toLowerCase().includes(searchQuery.toLowerCase());
                return matchesSearch;
            });

            if (serverTools.length > 0) {
                acc[server.serverName] = {
                    server,
                    tools: serverTools
                };
            }
        }
        return acc;
    }, {} as Record<string, { server: McpServer, tools: typeof hostedServers[number]['tools'] }>);

    // Group tools by server and filter based on search
    const groupedTools = tools.reduce((acc, tool, index) => {
        if (!tool.mcpServerName) return acc;
        
        const matchesSearch = 
            tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
            tool.mcpServerName.toLowerCase().includes(searchQuery.toLowerCase());

        if (!matchesSearch) return acc;

        if (!acc[tool.mcpServerName]) {
            acc[tool.mcpServerName] = [];
        }
        acc[tool.mcpServerName].push({ tool, index });
        return acc;
    }, {} as Record<string, { tool: z.infer<typeof WorkflowTool>, index: number }[]>);

    const toggleServerExpansion = (serverName: string) => {
        setExpandedServers(prev => {
            const next = new Set(prev);
            if (next.has(serverName)) {
                next.delete(serverName);
            } else {
                next.add(serverName);
            }
            return next;
        });
    };

    // Helper function to create a unique tool identifier
    const getToolId = (serverName: string, toolId: string | number) => `${serverName}:${String(toolId)}`;

    // Helper function to check if all tools in a server are selected
    const areAllToolsSelectedInServer = (serverName: string, tools: any[]) => {
        return tools.every((tool) => {
            const toolId = getToolId(serverName, 'id' in tool ? tool.id : tool.index);
            return selectedTools.has(toolId);
        });
    };

    // Helper function to check if some tools in a server are selected
    const areSomeToolsSelectedInServer = (serverName: string, tools: any[]) => {
        return tools.some((tool) => {
            const toolId = getToolId(serverName, 'id' in tool ? tool.id : tool.index);
            return selectedTools.has(toolId);
        });
    };

    // Helper function to toggle all tools in a server
    const toggleAllToolsInServer = (serverName: string, tools: any[], checked: boolean) => {
        setSelectedTools(prev => {
            const next = new Set(prev);
            tools.forEach((tool) => {
                const toolId = getToolId(serverName, 'id' in tool ? tool.id : tool.index);
                if (checked) {
                    next.add(toolId);
                } else {
                    next.delete(toolId);
                }
            });
            return next;
        });
    };

    // Helper function to count selected tools in a tab
    const getSelectedToolsCount = (isHostedTab: boolean) => {
        let count = 0;
        if (isHostedTab) {
            Object.entries(groupedHostedTools).forEach(([serverName, { server, tools }]) => {
                tools.forEach(tool => {
                    if (selectedTools.has(getToolId(serverName, tool.id))) {
                        count++;
                    }
                });
            });
        } else {
            Object.entries(groupedTools).forEach(([serverName, tools]) => {
                tools.forEach(({ tool, index }) => {
                    if (selectedTools.has(getToolId(serverName, index))) {
                        count++;
                    }
                });
            });
        }
        return count;
    };

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="xl">
            <ModalContent>
                {(onClose) => (
                    <>
                        <ModalHeader>Add Tool</ModalHeader>
                        <ModalBody className="max-h-[70vh] overflow-hidden">
                            <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
                                <TabsList className="grid w-full grid-cols-3 mb-6">
                                    <TabsTrigger value="hosted">Hosted MCP Servers</TabsTrigger>
                                    <TabsTrigger value="custom">Custom MCP Servers</TabsTrigger>
                                    <TabsTrigger value="webhook">Webhook</TabsTrigger>
                                </TabsList>

                                <TabsContent value="hosted" className="flex-1 overflow-hidden">
                                    <div className="space-y-4 mb-6">
                                        <div className="relative">
                                            <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                                            <input 
                                                type="text"
                                                placeholder="Search tools or servers..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md 
                                                    bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 
                                                    placeholder-gray-400 dark:placeholder-gray-500
                                                    focus:outline-none ring-0 focus:ring-0
                                                    transition-colors"
                                            />
                                        </div>
                                        {getSelectedToolsCount(true) > 0 && (
                                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                                {getSelectedToolsCount(true)} tools selected
                                            </div>
                                        )}
                                    </div>

                                    <div className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 220px)' }}>
                                        {loadingHosted && (
                                            <div className="flex items-center justify-center py-8">
                                                <Spinner size="sm" />
                                                <span className="ml-2">Loading hosted tools...</span>
                                            </div>
                                        )}

                                        {hostedError && (
                                            <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg text-red-700 dark:text-red-400">
                                                {hostedError}
                                                <Button
                                                    size="sm"
                                                    variant="solid"
                                                    color="danger"
                                                    className="mt-2"
                                                    onClick={fetchHostedServers}
                                                >
                                                    Retry
                                                </Button>
                                            </div>
                                        )}

                                        {!loadingHosted && !hostedError && Object.keys(groupedHostedTools).length === 0 && (
                                            <div className="text-center py-8 text-gray-500">
                                                No hosted tools found. Enable and authenticate tools in the Tools section first.
                                            </div>
                                        )}

                                        {/* Grouped Tools List */}
                                        <div className="space-y-4">
                                            {Object.entries(groupedHostedTools).map(([serverName, { server, tools }]) => (
                                                <div key={serverName} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                                    <button
                                                        onClick={() => toggleServerExpansion(serverName)}
                                                        className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <Checkbox
                                                                size="sm"
                                                                isSelected={areAllToolsSelectedInServer(serverName, tools)}
                                                                isIndeterminate={!areAllToolsSelectedInServer(serverName, tools) && areSomeToolsSelectedInServer(serverName, tools)}
                                                                onValueChange={(checked) => {
                                                                    toggleAllToolsInServer(serverName, tools, checked);
                                                                }}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                            <ServerLogo serverName={serverName} />
                                                            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                {serverName}
                                                            </h3>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                {tools.length} tools
                                                            </div>
                                                        </div>
                                                        {expandedServers.has(serverName) ? (
                                                            <ChevronDownIcon className="w-4 h-4 text-gray-500" />
                                                        ) : (
                                                            <ChevronRightIcon className="w-4 h-4 text-gray-500" />
                                                        )}
                                                    </button>
                                                    {expandedServers.has(serverName) && (
                                                        <div className="divide-y divide-gray-200 dark:divide-gray-700">
                                                            {tools.map((tool) => (
                                                                <div 
                                                                    key={tool.id}
                                                                    className="flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-800"
                                                                >
                                                                    <Checkbox
                                                                        size="sm"
                                                                        isSelected={selectedTools.has(getToolId(serverName, tool.id))}
                                                                        onValueChange={(checked) => {
                                                                            const toolId = getToolId(serverName, tool.id);
                                                                            setSelectedTools(prev => {
                                                                                const next = new Set(prev);
                                                                                if (checked) {
                                                                                    next.add(toolId);
                                                                                } else {
                                                                                    next.delete(toolId);
                                                                                }
                                                                                return next;
                                                                            });
                                                                        }}
                                                                    />
                                                                    <div>
                                                                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                            {tool.name}
                                                                        </div>
                                                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                            {tool.description}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </TabsContent>

                                <TabsContent value="custom" className="flex-1 overflow-hidden">
                                    <div className="space-y-4 mb-6">
                                        <div className="relative">
                                            <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                                            <input 
                                                type="text"
                                                placeholder="Search tools or servers..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-md 
                                                    bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 
                                                    placeholder-gray-400 dark:placeholder-gray-500
                                                    focus:outline-none ring-0 focus:ring-0
                                                    transition-colors"
                                            />
                                        </div>
                                        {getSelectedToolsCount(false) > 0 && (
                                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                                {getSelectedToolsCount(false)} tools selected
                                            </div>
                                        )}
                                    </div>

                                    <div className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 220px)' }}>
                                        {loading && (
                                            <div className="flex items-center justify-center py-8">
                                                <Spinner size="sm" />
                                                <span className="ml-2">Loading custom tools...</span>
                                            </div>
                                        )}

                                        {error && (
                                            <div className="bg-red-100 dark:bg-red-900/20 p-4 rounded-lg text-red-700 dark:text-red-400">
                                                {error}
                                                <Button
                                                    size="sm"
                                                    variant="solid"
                                                    color="danger"
                                                    className="mt-2"
                                                    onClick={process}
                                                >
                                                    Retry
                                                </Button>
                                            </div>
                                        )}

                                        {!loading && !error && Object.keys(groupedTools).length === 0 && (
                                            <div className="text-center py-8 text-gray-500">
                                                No custom MCP tools found
                                            </div>
                                        )}

                                        {/* Grouped Tools List */}
                                        <div className="space-y-4">
                                            {Object.entries(groupedTools).map(([serverName, tools]) => (
                                                <div key={serverName} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                                                    <button
                                                        onClick={() => toggleServerExpansion(serverName)}
                                                        className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <Checkbox
                                                                size="sm"
                                                                isSelected={areAllToolsSelectedInServer(serverName, tools)}
                                                                isIndeterminate={!areAllToolsSelectedInServer(serverName, tools) && areSomeToolsSelectedInServer(serverName, tools)}
                                                                onValueChange={(checked) => {
                                                                    toggleAllToolsInServer(serverName, tools, checked);
                                                                }}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                            <ServerLogo serverName={serverName} />
                                                            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                {serverName}
                                                            </h3>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                {tools.length} tools
                                                            </div>
                                                        </div>
                                                        {expandedServers.has(serverName) ? (
                                                            <ChevronDownIcon className="w-4 h-4 text-gray-500" />
                                                        ) : (
                                                            <ChevronRightIcon className="w-4 h-4 text-gray-500" />
                                                        )}
                                                    </button>
                                                    {expandedServers.has(serverName) && (
                                                        <div className="divide-y divide-gray-200 dark:divide-gray-700">
                                                            {tools.map(({ tool, index }) => (
                                                                <div 
                                                                    key={index}
                                                                    className="flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-800"
                                                                >
                                                                    <Checkbox
                                                                        size="sm"
                                                                        isSelected={selectedTools.has(getToolId(serverName, index))}
                                                                        onValueChange={(checked) => {
                                                                            const toolId = getToolId(serverName, index);
                                                                            setSelectedTools(prev => {
                                                                                const next = new Set(prev);
                                                                                if (checked) {
                                                                                    next.add(toolId);
                                                                                } else {
                                                                                    next.delete(toolId);
                                                                                }
                                                                                return next;
                                                                            });
                                                                        }}
                                                                    />
                                                                    <div>
                                                                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                                            {tool.name}
                                                                        </div>
                                                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                                                            {tool.description}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </TabsContent>

                                <TabsContent value="webhook" className="flex-1">
                                    <div className="space-y-6">
                                        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                                                Webhook URL
                                            </div>
                                            <div className="text-sm text-gray-600 dark:text-gray-400 font-mono break-all">
                                                {webhookUrl || 'No webhook URL configured'}
                                            </div>
                                        </div>
                                        
                                        <Button
                                            variant="solid"
                                            onClick={() => {
                                                onOpenChange(false);
                                                onConfigureWebhook();
                                            }}
                                        >
                                            {webhookUrl ? 'Configure Tool' : 'Configure Tool Anyway'}
                                        </Button>
                                    </div>
                                </TabsContent>
                            </Tabs>
                        </ModalBody>
                        <ModalFooter>
                            <Button size="sm" variant="flat" onPress={onClose}>
                                Cancel
                            </Button>
                            {(activeTab === 'hosted' || activeTab === 'custom') && 
                                <Button size="sm" onPress={() => {
                                    let selectedToolsList: z.infer<typeof WorkflowTool>[] = [];
                                    
                                    if (activeTab === 'hosted') {
                                        // Convert hosted tools to WorkflowTool format
                                        Object.values(groupedHostedTools).forEach(({ server, tools }) => {
                                            tools.forEach(tool => {
                                                const toolId = getToolId(server.serverName, tool.id);
                                                if (selectedTools.has(toolId)) {
                                                    selectedToolsList.push({
                                                        name: tool.name,
                                                        description: tool.description,
                                                        parameters: {
                                                            type: 'object',
                                                            properties: {},
                                                            required: []
                                                        },
                                                        isMcp: true,
                                                        mcpServerName: server.serverName,
                                                        mcpServerURL: server.serverUrl
                                                    });
                                                }
                                            });
                                        });
                                    } else {
                                        // Use existing custom tools logic
                                        Object.entries(groupedTools).forEach(([serverName, tools]) => {
                                            tools.forEach(({ tool, index }) => {
                                                const toolId = getToolId(serverName, index);
                                                if (selectedTools.has(toolId)) {
                                                    selectedToolsList.push(tool);
                                                }
                                            });
                                        });
                                    }
                                    
                                    onImport(selectedToolsList);
                                    onClose();
                                }}>
                                    Import Selected
                                </Button>
                            }
                        </ModalFooter>
                    </>
                )}
            </ModalContent>
        </Modal>
    );
} 