'use client';

import { useState, useEffect, useMemo } from "react";
import { Spinner, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from "@heroui/react";
import { getProjectConfig, updateWebhookUrl } from "../../../../actions/project_actions";
import { updateMcpServers } from "../../../../actions/mcp_actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlusIcon } from "lucide-react";
import { sectionHeaderStyles, sectionDescriptionStyles, inputStyles } from './shared-styles';
import { clsx } from "clsx";

function Section({ title, children, description }: { 
    title: string; 
    children: React.ReactNode;
    description?: string;
}) {
    return (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
            <div className="px-6 pt-4">
                <h2 className={sectionHeaderStyles}>{title}</h2>
                {description && (
                    <p className={sectionDescriptionStyles}>{description}</p>
                )}
            </div>
            <div className="px-6 pb-6">{children}</div>
        </div>
    );
}

function McpServersSection({ projectId }: { projectId: string }) {
    const [servers, setServers] = useState<Array<{ name: string; url: string }>>([]);
    const [originalServers, setOriginalServers] = useState<Array<{ name: string; url: string }>>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [newServer, setNewServer] = useState({ name: '', url: '' });
    const [validationErrors, setValidationErrors] = useState<{
        name?: string;
        url?: string;
    }>({});

    useEffect(() => {
        setLoading(true);
        getProjectConfig(projectId).then((project) => {
            const initialServers = project.mcpServers || [];
            setServers(JSON.parse(JSON.stringify(initialServers)));
            setOriginalServers(JSON.parse(JSON.stringify(initialServers)));
            setLoading(false);
        });
    }, [projectId]);

    const hasChanges = useMemo(() => {
        if (servers.length !== originalServers.length) return true;
        return servers.some((server, index) => {
            return server.name !== originalServers[index]?.name || 
                   server.url !== originalServers[index]?.url;
        });
    }, [servers, originalServers]);

    const handleAddServer = () => {
        setNewServer({ name: '', url: '' });
        setValidationErrors({});
        onOpen();
    };

    const handleRemoveServer = (index: number) => {
        setServers(servers.filter((_, i) => i !== index));
    };

    const handleCreateServer = () => {
        setValidationErrors({});
        
        const errors: typeof validationErrors = {};

        if (!newServer.name.trim()) {
            errors.name = 'Server name is required';
        } else if (servers.some(s => s.name === newServer.name)) {
            errors.name = 'Server name must be unique';
        }

        if (!newServer.url.trim()) {
            errors.url = 'Server URL is required';
        } else {
            try {
                new URL(newServer.url);
            } catch {
                errors.url = 'Invalid URL format';
            }
        }

        if (Object.keys(errors).length > 0) {
            setValidationErrors(errors);
            return;
        }

        setServers([...servers, newServer]);
        onClose();
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateMcpServers(projectId, servers);
            setOriginalServers(JSON.parse(JSON.stringify(servers)));
            setMessage({ type: 'success', text: 'Servers updated successfully' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            setMessage({ type: 'error', text: 'Failed to update servers' });
        }
        setSaving(false);
    };

    return <Section 
        title="MCP Servers"
        description="MCP servers are used to execute MCP tools."
    >
        <div className="space-y-4">
            <div className="flex justify-start">
                <Button
                    size="sm"
                    variant="primary"
                    onClick={handleAddServer}
                >
                    + Add Server
                </Button>
            </div>

            {loading ? (
                <Spinner size="sm" />
            ) : (
                <>
                    <div className="space-y-3">
                        {servers.map((server, index) => (
                            <div key={index} className="flex gap-3 items-center p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800">
                                <div className="flex-1">
                                    <div className="font-medium">{server.name}</div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400">{server.url}</div>
                                </div>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleRemoveServer(index)}
                                >
                                    Remove
                                </Button>
                            </div>
                        ))}
                        {servers.length === 0 && (
                            <div className="text-center text-gray-500 dark:text-gray-400 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
                                No servers configured
                            </div>
                        )}
                    </div>

                    {hasChanges && (
                        <div className="flex justify-end pt-4">
                            <Button
                                size="sm"
                                variant="primary"
                                onClick={handleSave}
                                isLoading={saving}
                            >
                                Save Changes
                            </Button>
                        </div>
                    )}

                    {message && (
                        <div className={clsx(
                            "mt-4 text-sm p-4 rounded-lg",
                            message.type === 'success' 
                                ? "bg-green-50 text-green-700 border border-green-200" 
                                : "bg-red-50 text-red-700 border border-red-200"
                        )}>
                            {message.text}
                        </div>
                    )}
                </>
            )}

            <Modal isOpen={isOpen} onClose={onClose}>
                <ModalContent>
                    <ModalHeader>Add MCP Server</ModalHeader>
                    <ModalBody>
                        <div className="flex flex-col gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Server Name</label>
                                <Input
                                    placeholder="Enter server name"
                                    value={newServer.name}
                                    onChange={(e) => {
                                        setNewServer({ ...newServer, name: e.target.value });
                                        if (validationErrors.name) {
                                            setValidationErrors(prev => ({
                                                ...prev,
                                                name: undefined
                                            }));
                                        }
                                    }}
                                    className={inputStyles}
                                    required
                                />
                                {validationErrors.name && (
                                    <p className="text-sm text-red-500">{validationErrors.name}</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">SSE URL</label>
                                <Input
                                    placeholder="http://host.docker.internal:8000/sse"
                                    value={newServer.url}
                                    onChange={(e) => {
                                        setNewServer({ ...newServer, url: e.target.value });
                                        if (validationErrors.url) {
                                            setValidationErrors(prev => ({
                                                ...prev,
                                                url: undefined
                                            }));
                                        }
                                    }}
                                    className={inputStyles}
                                    required
                                />
                                {validationErrors.url && (
                                    <p className="text-sm text-red-500">{validationErrors.url}</p>
                                )}
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="secondary" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            onClick={handleCreateServer}
                            disabled={!newServer.name || !newServer.url}
                        >
                            Add Server
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    </Section>;
}

export function WebhookUrlSection({ projectId }: { projectId: string }) {
    const [loading, setLoading] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        getProjectConfig(projectId).then((project) => {
            setWebhookUrl(project.webhookUrl || null);
            setLoading(false);
        });
    }, [projectId]);

    function validate(url: string) {
        try {
            new URL(url);
            setError(null);
            return { valid: true };
        } catch {
            setError('Please enter a valid URL');
            return { valid: false, errorMessage: 'Please enter a valid URL' };
        }
    }

    return <Section 
        title="Webhook URL"
        description="In workflow editor, tool calls will be posted to this URL, unless they are mocked."
    >
        <div className="space-y-2">
            <div className={clsx(
                "border rounded-lg focus-within:ring-2",
                error 
                    ? "border-red-500 focus-within:ring-red-500/20" 
                    : "border-gray-200 dark:border-gray-700 focus-within:ring-indigo-500/20 dark:focus-within:ring-indigo-400/20"
            )}>
                <Textarea
                    value={webhookUrl || ''}
                    useValidation={true}
                    updateOnBlur={true}
                    validate={validate}
                    onValidatedChange={(value) => {
                        setWebhookUrl(value);
                        updateWebhookUrl(projectId, value);
                    }}
                    placeholder="Enter webhook URL..."
                    className="w-full text-sm bg-transparent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-colors px-4 py-3"
                    autoResize
                />
            </div>
            {error && (
                <p className="text-sm text-red-500">{error}</p>
            )}
        </div>
    </Section>;
}

export function ToolsSection({ projectId }: { projectId: string }) {
    return (
        <div className="p-6 space-y-6">
            <McpServersSection projectId={projectId} />
            <WebhookUrlSection projectId={projectId} />
        </div>
    );
}

export default ToolsSection;