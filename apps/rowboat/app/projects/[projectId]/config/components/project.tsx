'use client';

import { ReactNode, useEffect, useState, useCallback } from "react";
import { Spinner, Dropdown, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, useDisclosure } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { getProjectConfig, createApiKey, deleteApiKey, listApiKeys, deleteProject, rotateSecret, updateProjectName, saveWorkflow } from "../../../../actions/project.actions";
import { CopyButton } from "../../../../../components/common/copy-button";
import { EyeIcon, EyeOffIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { WithStringId } from "../../../../lib/types/types";
import { ApiKey } from "@/src/entities/models/api-key";
import { z } from "zod";
import { RelativeTime } from "@primer/react";
import { Label } from "../../../../lib/components/label";
import { sectionHeaderStyles, sectionDescriptionStyles } from './shared-styles';
import { clsx } from "clsx";
import { InputField } from "../../../../lib/components/input-field";
import { Project, ComposioConnectedAccount } from "../../../../lib/types/project_types";
import { getToolkit, listComposioTriggerDeployments, deleteComposioTriggerDeployment } from "../../../../actions/composio.actions";
import { deleteConnectedAccount } from "../../../../actions/composio.actions";
import { PictureImg } from "@/components/ui/picture-img";
import { UnlinkIcon, AlertTriangle, Trash2 } from "lucide-react";
import { ProjectWideChangeConfirmationModal } from "@/components/common/project-wide-change-confirmation-modal";
import { Workflow } from "../../../../lib/types/workflow_types";

export function Section({
    title,
    children,
    description,
}: {
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

export function SectionRow({
    children,
}: {
    children: ReactNode;
}) {
    return <div className="flex flex-col gap-2">{children}</div>;
}

export function LeftLabel({
    label,
}: {
    label: string;
}) {
    return <Label label={label} />;
}

export function RightContent({
    children,
}: {
    children: React.ReactNode;
}) {
    return <div>{children}</div>;
}

function ProjectNameSection({ 
    projectId, 
    onProjectConfigUpdated 
}: { 
    projectId: string;
    onProjectConfigUpdated?: () => void;
}) {
    const [loading, setLoading] = useState(false);
    const [projectName, setProjectName] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        getProjectConfig(projectId).then((project) => {
            setProjectName(project?.name);
            setLoading(false);
        });
    }, [projectId]);

    async function updateName(name: string) {
        setLoading(true);
        await updateProjectName(projectId, name);
        setProjectName(name);
        setLoading(false);
        if (onProjectConfigUpdated) {
            onProjectConfigUpdated();
        }
    }

    return <Section 
        title="Project Name"
        description="The name of your project."
    >
        <div className="space-y-4">
            {loading ? (
                <Spinner size="sm" />
            ) : (
                <InputField
                    type="text"
                    value={projectName || ''}
                    onChange={updateName}
                    className="w-full"
                />
            )}
        </div>
    </Section>;
}

function ProjectIdSection({ projectId }: { projectId: string }) {
    return <Section 
        title="Project ID"
        description="Your project's unique identifier."
    >
        <div className="flex flex-row gap-2 items-center">
            <div className="text-sm font-mono text-gray-600 dark:text-gray-400">{projectId}</div>
            <CopyButton
                onCopy={() => navigator.clipboard.writeText(projectId)}
                label="Copy"
                successLabel="Copied"
            />
        </div>
    </Section>;
}

function SecretSection({ projectId }: { projectId: string }) {
    const [loading, setLoading] = useState(false);
    const [hidden, setHidden] = useState(true);
    const [secret, setSecret] = useState<string | null>(null);

    const formattedSecret = hidden ? `${secret?.slice(0, 2)}${'•'.repeat(5)}${secret?.slice(-2)}` : secret;

    useEffect(() => {
        setLoading(true);
        getProjectConfig(projectId).then((project) => {
            setSecret(project.secret);
            setLoading(false);
        });
    }, [projectId]);

    const handleRotateSecret = async () => {
        if (!confirm("Are you sure you want to rotate the secret? All existing signatures will become invalid.")) {
            return;
        }
        setLoading(true);
        try {
            const newSecret = await rotateSecret(projectId);
            setSecret(newSecret);
        } catch (error) {
            console.error('Failed to rotate secret:', error);
        } finally {
            setLoading(false);
        }
    };

    return <Section 
        title="Project Secret"
        description="The project secret is used for signing tool-call requests sent to your webhook."
    >
        <div className="space-y-4">
            {loading ? (
                <Spinner size="sm" />
            ) : (
                <div className="flex flex-row gap-4 items-center">
                    <div className="text-sm font-mono break-all text-gray-600 dark:text-gray-400">
                        {formattedSecret}
                    </div>
                    <div className="flex flex-row gap-4 items-center">
                        <button
                            onClick={() => setHidden(!hidden)}
                            className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                        >
                            {hidden ? <EyeIcon size={16} /> : <EyeOffIcon size={16} />}
                        </button>
                        <CopyButton
                            onCopy={() => navigator.clipboard.writeText(secret || '')}
                            label="Copy"
                            successLabel="Copied"
                        />
                        <Button
                            size="sm"
                            variant="primary"
                            onClick={handleRotateSecret}
                            disabled={loading}
                        >
                            Rotate
                        </Button>
                    </div>
                </div>
            )}
        </div>
    </Section>;
}

function ApiKeyDisplay({ apiKey, onDelete }: { apiKey: string; onDelete: () => void }) {
    const [isVisible, setIsVisible] = useState(false);
    const formattedKey = isVisible ? apiKey : `${apiKey.slice(0, 2)}${'•'.repeat(5)}${apiKey.slice(-2)}`;

    return (
        <div className="flex items-center gap-2">
            <div className="text-sm font-mono break-all">
                {formattedKey}
            </div>
            <button
                onClick={() => setIsVisible(!isVisible)}
                className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            >
                {isVisible ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
            </button>
            <CopyButton
                onCopy={() => navigator.clipboard.writeText(apiKey)}
                label="Copy"
                successLabel="Copied"
            />
            <button
                onClick={onDelete}
                className="text-gray-600 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
            >
                <Trash2Icon className="w-4 h-4" />
            </button>
        </div>
    );
}

function ApiKeysSection({ projectId }: { projectId: string }) {
    const [keys, setKeys] = useState<z.infer<typeof ApiKey>[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<{
        type: 'success' | 'error' | 'info';
        text: string;
    } | null>(null);

    const loadKeys = useCallback(async () => {
        const keys = await listApiKeys(projectId);
        setKeys(keys);
        setLoading(false);
    }, [projectId]);

    useEffect(() => {
        loadKeys();
    }, [loadKeys]);

    const handleCreateKey = async () => {
        setLoading(true);
        setMessage(null);
        try {
            const key = await createApiKey(projectId);
            setKeys([...keys, key]);
            setMessage({
                type: 'success',
                text: 'API key created successfully',
            });
            setTimeout(() => setMessage(null), 2000);
        } catch (error) {
            setMessage({
                type: 'error',
                text: error instanceof Error ? error.message : "Failed to create API key",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteKey = async (id: string) => {
        if (!confirm("Are you sure you want to delete this API key? This action cannot be undone.")) {
            return;
        }

        try {
            setLoading(true);
            await deleteApiKey(projectId, id);
            setKeys(keys.filter((k) => k.id !== id));
            setMessage({
                type: 'info',
                text: 'API key deleted successfully',
            });
            setTimeout(() => setMessage(null), 2000);
        } catch (error) {
            setMessage({
                type: 'error',
                text: error instanceof Error ? error.message : "Failed to delete API key",
            });
        } finally {
            setLoading(false);
        }
    };

    return <Section 
        title="API Keys"
        description="API keys are used to authenticate requests to the Rowboat API."
    >
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <Button
                    size="sm"
                    variant="primary"
                    startContent={<PlusIcon className="w-4 h-4" />}
                    onClick={handleCreateKey}
                    disabled={loading}
                >
                    Create API Key
                </Button>
            </div>

            {loading ? (
                <Spinner size="sm" />
            ) : (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-12 items-center border-b border-gray-200 dark:border-gray-700 p-4">
                        <div className="col-span-7 font-medium text-gray-900 dark:text-gray-100">API Key</div>
                        <div className="col-span-3 font-medium text-gray-900 dark:text-gray-100">Created</div>
                        <div className="col-span-2 font-medium text-gray-900 dark:text-gray-100">Last Used</div>
                    </div>
                    
                    {message && (
                        <div className={clsx(
                            "p-4 text-sm",
                            message.type === 'success' && "bg-green-50 text-green-700",
                            message.type === 'error' && "bg-red-50 text-red-700",
                            message.type === 'info' && "bg-yellow-50 text-yellow-700"
                        )}>
                            {message.text}
                        </div>
                    )}

                    {keys.map((key) => (
                        <div key={key.id} className="grid grid-cols-12 items-center border-b border-gray-200 dark:border-gray-700 last:border-0 p-4">
                            <div className="col-span-7">
                                <ApiKeyDisplay 
                                    apiKey={key.key} 
                                    onDelete={() => handleDeleteKey(key.id)}
                                />
                            </div>
                            <div className="col-span-3 text-sm text-gray-500">
                                <RelativeTime date={new Date(key.createdAt)} />
                            </div>
                            <div className="col-span-2 text-sm text-gray-500">
                                {key.lastUsedAt ? (
                                    <RelativeTime date={new Date(key.lastUsedAt)} />
                                ) : 'Never'}
                            </div>
                        </div>
                    ))}
                    
                    {keys.length === 0 && (
                        <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                            No API keys created yet
                        </div>
                    )}
                </div>
            )}
        </div>
    </Section>;
}

export function ChatWidgetSection({ projectId, chatWidgetHost }: { projectId: string, chatWidgetHost: string }) {
    const [loading, setLoading] = useState(false);
    const [chatClientId, setChatClientId] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        getProjectConfig(projectId).then((project) => {
            setChatClientId(project.chatClientId);
            setLoading(false);
        });
    }, [projectId]);

    const code = `<!-- RowBoat Chat Widget -->
<script>
    window.ROWBOAT_CONFIG = {
        clientId: '${chatClientId}'
    };
    (function(d) {
        var s = d.createElement('script');
        s.src = '${chatWidgetHost}/api/bootstrap.js';
        s.async = true;
        d.getElementsByTagName('head')[0].appendChild(s);
    })(document);
</script>`;

    return (
        <Section 
            title="Chat Widget"
            description="Add the chat widget to your website by copying and pasting this code snippet just before the closing </body> tag."
        >
            <div className="space-y-4">
                {loading ? (
                    <Spinner size="sm" />
                ) : (
                    <div className="relative">
                        <div className="absolute top-3 right-3">
                            <CopyButton
                                onCopy={() => navigator.clipboard.writeText(code)}
                                label="Copy"
                                successLabel="Copied"
                            />
                        </div>
                        <div className="font-mono text-sm bg-gray-50 dark:bg-gray-800 rounded-lg p-4 pr-12 overflow-x-auto">
                            <pre className="whitespace-pre-wrap break-all">
                                {code}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
        </Section>
    );
}

interface ConnectedToolkit {
    slug: string;
    name: string;
    logo: string;
    connectedAccount: z.infer<typeof ComposioConnectedAccount> | null;
}

function DisconnectToolkitsSection({ projectId, onProjectConfigUpdated }: { 
    projectId: string; 
    onProjectConfigUpdated?: () => void;
}) {
    const [loading, setLoading] = useState(false);
    const [connectedToolkits, setConnectedToolkits] = useState<ConnectedToolkit[]>([]);
    const [disconnectingToolkit, setDisconnectingToolkit] = useState<string | null>(null);
    const [removingToolkit, setRemovingToolkit] = useState<string | null>(null);
    const [showDisconnectModal, setShowDisconnectModal] = useState(false);
    const [showRemoveModal, setShowRemoveModal] = useState(false);
    const [selectedToolkit, setSelectedToolkit] = useState<ConnectedToolkit | null>(null);

    const loadConnectedToolkits = useCallback(async () => {
        setLoading(true);
        try {
            const project = await getProjectConfig(projectId);
            const connectedAccounts = project.composioConnectedAccounts || {};
            const workflow = project.draftWorkflow;
            
            // Get all connected accounts (both active and inactive)
            const allConnections = Object.entries(connectedAccounts);
            
            // Get all Composio toolkits used in workflow tools (even if not connected)
            const workflowToolkitSlugs = new Set<string>();
            if (workflow?.tools) {
                workflow.tools.forEach(tool => {
                    if (tool.isComposio && tool.composioData?.toolkitSlug) {
                        workflowToolkitSlugs.add(tool.composioData.toolkitSlug);
                    }
                });
            }
            
            // Combine connected accounts and workflow toolkits
            const allToolkitSlugs = new Set([
                ...allConnections.map(([slug]) => slug),
                ...workflowToolkitSlugs
            ]);

            // Fetch toolkit details for each toolkit
            const toolkitPromises = Array.from(allToolkitSlugs).map(async (slug) => {
                try {
                    const toolkit = await getToolkit(projectId, slug);
                    const connectedAccount = connectedAccounts[slug];
                    
                    return {
                        slug,
                        name: toolkit.name,
                        logo: toolkit.meta.logo,
                        connectedAccount: connectedAccount || null // null if not connected
                    };
                } catch (error) {
                    console.error(`Failed to fetch toolkit ${slug}:`, error);
                    return null;
                }
            });

            const toolkits = (await Promise.all(toolkitPromises)).filter(Boolean) as (ConnectedToolkit | ConnectedToolkit & { connectedAccount: null })[];
            setConnectedToolkits(toolkits);
        } catch (error) {
            console.error('Failed to load connected toolkits:', error);
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        loadConnectedToolkits();
    }, [loadConnectedToolkits]);

    const handleDisconnectClick = (toolkit: ConnectedToolkit) => {
        setSelectedToolkit(toolkit);
        setShowDisconnectModal(true);
    };

    const handleRemoveClick = (toolkit: ConnectedToolkit) => {
        setSelectedToolkit(toolkit);
        setShowRemoveModal(true);
    };

    const handleConfirmDisconnect = async () => {
        if (!selectedToolkit || !selectedToolkit.connectedAccount) return;
        
        setDisconnectingToolkit(selectedToolkit.slug);
        try {
            await deleteConnectedAccount(
                projectId, 
                selectedToolkit.slug, 
                selectedToolkit.connectedAccount.id
            );
            
            // Update toolkit status in local state to show as disconnected
            setConnectedToolkits(prev => 
                prev.map(toolkit => 
                    toolkit.slug === selectedToolkit.slug 
                        ? { ...toolkit, connectedAccount: { ...toolkit.connectedAccount!, status: 'INITIATED' as const } }
                        : toolkit
                )
            );
            
            // Notify parent of config update
            onProjectConfigUpdated?.();
        } catch (error) {
            console.error('Disconnect failed:', error);
        } finally {
            setDisconnectingToolkit(null);
            setShowDisconnectModal(false);
            setSelectedToolkit(null);
        }
    };

    const handleConfirmRemove = async () => {
        if (!selectedToolkit) return;
        
        setRemovingToolkit(selectedToolkit.slug);
        try {
            // Step 1: Get current project and workflow
            const project = await getProjectConfig(projectId);
            const currentWorkflow = project.draftWorkflow;
            
            if (currentWorkflow) {
                // Step 2: Remove all tools from this toolkit from the workflow
                const updatedTools = currentWorkflow.tools.filter(tool => 
                    !tool.isComposio || tool.composioData?.toolkitSlug !== selectedToolkit.slug
                );
                
                // Step 3: Update the workflow
                const updatedWorkflow: z.infer<typeof Workflow> = {
                    ...currentWorkflow,
                    tools: updatedTools
                };
                
                await saveWorkflow(projectId, updatedWorkflow);
            }
            
            // Step 4: Delete all triggers for this toolkit
            const triggers = await listComposioTriggerDeployments({ projectId });
            const toolkitTriggers = triggers.items.filter(trigger => trigger.toolkitSlug === selectedToolkit.slug);
            
            for (const trigger of toolkitTriggers) {
                try {
                    await deleteComposioTriggerDeployment({
                        projectId,
                        deploymentId: trigger.id
                    });
                } catch (error) {
                    console.error(`Failed to delete trigger ${trigger.id}:`, error);
                    // Continue with other triggers
                }
            }
            
            // Step 5: Disconnect the account (if connected)
            if (selectedToolkit.connectedAccount) {
                await deleteConnectedAccount(
                    projectId, 
                    selectedToolkit.slug, 
                    selectedToolkit.connectedAccount.id
                );
            }
            
            // Remove from local state
            setConnectedToolkits(prev => 
                prev.filter(toolkit => toolkit.slug !== selectedToolkit.slug)
            );
            
            // Notify parent of config update
            onProjectConfigUpdated?.();
        } catch (error) {
            console.error('Remove toolkit failed:', error);
        } finally {
            setRemovingToolkit(null);
            setShowRemoveModal(false);
            setSelectedToolkit(null);
        }
    };

    return (
        <>
            <Section 
                title="Composio Toolkits"
                description="Manage your Composio toolkits. Shows all toolkits added to your project, whether connected or not. Disconnect to temporarily disable access, or Remove to permanently delete all tools and triggers."
            >
                <div className="space-y-4">
                    {loading ? (
                        <Spinner size="sm" />
                    ) : connectedToolkits.length > 0 ? (
                        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                            {connectedToolkits.map((toolkit) => (
                                <div 
                                    key={toolkit.slug}
                                    className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 last:border-0"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 flex items-center justify-center">
                                            {toolkit.logo ? (
                                                <PictureImg
                                                    src={toolkit.logo}
                                                    alt={`${toolkit.name} logo`}
                                                    className="w-full h-full object-contain rounded"
                                                />
                                            ) : (
                                                <div className="w-full h-full bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center">
                                                    <span className="text-xs font-medium text-gray-500">
                                                        {toolkit.name.charAt(0).toUpperCase()}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <div className="font-medium text-gray-900 dark:text-gray-100">
                                                {toolkit.name}
                                            </div>
                                            <div className="flex items-center gap-2 mt-1">
                                                {toolkit.connectedAccount?.status === 'ACTIVE' ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-green-300 bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-200 dark:border-green-700">
                                                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                                                        Connected
                                                    </span>
                                                ) : toolkit.connectedAccount ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-gray-300 bg-gray-50 text-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:border-gray-700">
                                                        <span className="w-2 h-2 bg-gray-500 rounded-full"></span>
                                                        Disconnected
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-yellow-300 bg-yellow-50 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-700">
                                                        <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                                                        Not Connected
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {toolkit.connectedAccount?.status === 'ACTIVE' ? (
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                startContent={<UnlinkIcon className="w-4 h-4" />}
                                                onClick={() => handleDisconnectClick(toolkit)}
                                                disabled={disconnectingToolkit === toolkit.slug || removingToolkit === toolkit.slug}
                                                isLoading={disconnectingToolkit === toolkit.slug}
                                            >
                                                {disconnectingToolkit === toolkit.slug ? 'Disconnecting...' : 'Disconnect'}
                                            </Button>
                                        ) : toolkit.connectedAccount ? (
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                disabled={true}
                                            >
                                                Disconnected
                                            </Button>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                disabled={true}
                                            >
                                                Not Connected
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            color="danger"
                                            startContent={<Trash2 className="w-4 h-4" />}
                                            onClick={() => handleRemoveClick(toolkit)}
                                            disabled={disconnectingToolkit === toolkit.slug || removingToolkit === toolkit.slug}
                                            isLoading={removingToolkit === toolkit.slug}
                                        >
                                            {removingToolkit === toolkit.slug ? 'Removing...' : 'Remove'}
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                            <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                            <p className="text-sm">No toolkits found</p>
                            <p className="text-xs mt-1">Connect toolkits from the workflow editor or triggers to manage them here</p>
                        </div>
                    )}
                </div>
            </Section>

            {/* Disconnect Confirmation Modal */}
            <ProjectWideChangeConfirmationModal
                isOpen={showDisconnectModal}
                onClose={() => {
                    setShowDisconnectModal(false);
                    setSelectedToolkit(null);
                }}
                onConfirm={handleConfirmDisconnect}
                title={`Disconnect ${selectedToolkit?.name || 'Toolkit'}`}
                confirmationQuestion={`Are you sure you want to disconnect the ${selectedToolkit?.name || 'toolkit'}? This will remove access to all its tools and disable any triggers from this toolkit. Your workflows may stop working properly if they depend on this toolkit.`}
                confirmButtonText="Disconnect"
                isLoading={disconnectingToolkit !== null}
            />

            {/* Remove Toolkit Confirmation Modal */}
            <ProjectWideChangeConfirmationModal
                isOpen={showRemoveModal}
                onClose={() => {
                    setShowRemoveModal(false);
                    setSelectedToolkit(null);
                }}
                onConfirm={handleConfirmRemove}
                title={`Remove ${selectedToolkit?.name || 'Toolkit'}`}
                confirmationQuestion={`Are you sure you want to remove the ${selectedToolkit?.name || 'toolkit'} and all its tools and triggers? This will permanently delete all tools and triggers from this toolkit and disconnect it. Your workflows may stop working properly if they depend on this toolkit.`}
                confirmButtonText="Remove Toolkit"
                isLoading={removingToolkit !== null}
            />
        </>
    );
}

function DeleteProjectSection({ projectId }: { projectId: string }) {
    const [loadingInitial, setLoadingInitial] = useState(false);
    const [deletingProject, setDeletingProject] = useState(false);
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [projectName, setProjectName] = useState("");
    const [projectNameInput, setProjectNameInput] = useState("");
    const [confirmationInput, setConfirmationInput] = useState("");
    const [error, setError] = useState<string | null>(null);
    
    const isValid = projectNameInput === projectName && confirmationInput === "delete project";

    useEffect(() => {
        setLoadingInitial(true);
        getProjectConfig(projectId).then((project) => {
            setProjectName(project.name);
            setLoadingInitial(false);
        });
    }, [projectId]);

    const handleDelete = async () => {
        if (!isValid) return;
        setError(null);
        setDeletingProject(true);
        try {
            await deleteProject(projectId);
        } catch (error) {
            setError(error instanceof Error ? error.message : "Failed to delete project");
            setDeletingProject(false);
            return;
        }
        setDeletingProject(false);
    };

    return (
        <Section 
            title="Delete Project"
            description="Permanently delete this project and all its data."
        >
            <div className="space-y-4">
                <div className="p-4 bg-red-50/10 dark:bg-red-900/10 rounded-lg">
                    <p className="text-sm text-red-700 dark:text-red-300">
                        Deleting a project will permanently remove all associated data, including workflows, sources, and API keys.
                        This action cannot be undone.
                    </p>
                </div>

                <Button 
                    variant="primary"
                    size="sm"
                    onClick={onOpen}
                    disabled={loadingInitial}
                    color="red"
                >
                    Delete project
                </Button>

                <Modal isOpen={isOpen} onClose={onClose}>
                    <ModalContent>
                        <ModalHeader>Delete Project</ModalHeader>
                        <ModalBody>
                            <div className="space-y-4">
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    This action cannot be undone. Please type in the following to confirm:
                                </p>
                                <Input
                                    label="Project name"
                                    placeholder={projectName}
                                    value={projectNameInput}
                                    onChange={(e) => setProjectNameInput(e.target.value)}
                                />
                                <Input
                                    label='Type "delete project" to confirm'
                                    placeholder="delete project"
                                    value={confirmationInput}
                                    onChange={(e) => setConfirmationInput(e.target.value)}
                                />
                                {error && (
                                    <div className="p-4 text-sm text-red-700 bg-red-50 dark:bg-red-900/10 dark:text-red-400 rounded-lg">
                                        {error}
                                    </div>
                                )}
                            </div>
                        </ModalBody>
                        <ModalFooter>
                            <Button 
                                variant="secondary" 
                                onClick={onClose}
                                disabled={deletingProject}
                            >
                                Cancel
                            </Button>
                            <Button 
                                variant="primary"
                                color="danger"
                                onClick={handleDelete}
                                disabled={!isValid || deletingProject}
                                isLoading={deletingProject}
                            >
                                Delete Project
                            </Button>
                        </ModalFooter>
                    </ModalContent>
                </Modal>
            </div>
        </Section>
    );
}

export function ProjectSection({
    projectId,
    useChatWidget,
    chatWidgetHost,
}: {
    projectId: string;
    useChatWidget: boolean;
    chatWidgetHost: string;
}) {
    return (
        <div className="p-6 space-y-6">
            <ProjectIdSection projectId={projectId} />
            <ApiKeysSection projectId={projectId} />
            {useChatWidget && <ChatWidgetSection projectId={projectId} chatWidgetHost={chatWidgetHost} />}
        </div>
    );
}

export function SimpleProjectSection({
    projectId,
    onProjectConfigUpdated,
}: {
    projectId: string;
    onProjectConfigUpdated?: () => void;
}) {
    return (
        <div className="p-6 space-y-6">
            <ProjectNameSection projectId={projectId} onProjectConfigUpdated={onProjectConfigUpdated} />
            <SecretSection projectId={projectId} />
            <DisconnectToolkitsSection projectId={projectId} onProjectConfigUpdated={onProjectConfigUpdated} />
            <DeleteProjectSection projectId={projectId} />
        </div>
    );
}
