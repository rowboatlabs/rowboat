'use client';

import { ReactNode, useEffect, useState, useCallback } from "react";
import { Spinner, Dropdown, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, useDisclosure } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getProjectConfig, updateProjectName, createApiKey, deleteApiKey, listApiKeys, deleteProject, rotateSecret } from "../../../../actions/project_actions";
import { CopyButton } from "../../../../../components/common/copy-button";
import { EyeIcon, EyeOffIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { WithStringId } from "../../../../lib/types/types";
import { ApiKey } from "../../../../lib/types/project_types";
import { z } from "zod";
import { RelativeTime } from "@primer/react";
import { Label } from "../../../../lib/components/label";
import { sectionHeaderStyles, sectionDescriptionStyles } from './shared-styles';
import { clsx } from "clsx";

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

function ProjectNameSection({ projectId }: { projectId: string }) {
    const [loading, setLoading] = useState(false);
    const [projectName, setProjectName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        getProjectConfig(projectId).then((project) => {
            setProjectName(project?.name);
            setLoading(false);
        });
    }, [projectId]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        setProjectName(value);
        
        if (!value.trim()) {
            setError("Project name cannot be empty");
            return;
        }
        
        setError(null);
        updateProjectName(projectId, value);
    };

    return <Section 
        title="Project Name"
        description="The name of your project."
    >
        {loading ? (
            <Spinner size="sm" />
        ) : (
            <div className="space-y-2">
                <div className={clsx(
                    "border rounded-lg focus-within:ring-2",
                    error 
                        ? "border-red-500 focus-within:ring-red-500/20" 
                        : "border-gray-200 dark:border-gray-700 focus-within:ring-indigo-500/20 dark:focus-within:ring-indigo-400/20"
                )}>
                    <Textarea
                        value={projectName || ''}
                        onChange={handleChange}
                        placeholder="Enter project name..."
                        className="w-full text-sm bg-transparent border-0 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-colors px-4 py-3"
                        autoResize
                    />
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
        )}
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
    const [keys, setKeys] = useState<WithStringId<z.infer<typeof ApiKey>>[]>([]);
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
            setKeys(keys.filter((k) => k._id !== id));
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
                        <div key={key._id} className="grid grid-cols-12 items-center border-b border-gray-200 dark:border-gray-700 last:border-0 p-4">
                            <div className="col-span-7">
                                <ApiKeyDisplay 
                                    apiKey={key.key} 
                                    onDelete={() => handleDeleteKey(key._id)}
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

function ChatWidgetSection({ projectId, chatWidgetHost }: { projectId: string, chatWidgetHost: string }) {
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
            <ProjectNameSection projectId={projectId} />
            <ProjectIdSection projectId={projectId} />
            <SecretSection projectId={projectId} />
            <ApiKeysSection projectId={projectId} />
            {useChatWidget && <ChatWidgetSection projectId={projectId} chatWidgetHost={chatWidgetHost} />}
            <DeleteProjectSection projectId={projectId} />
        </div>
    );
}
