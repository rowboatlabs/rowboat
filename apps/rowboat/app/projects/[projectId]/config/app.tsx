'use client';

import { Metadata } from "next";
import { Spinner, Textarea, Button, Dropdown, DropdownMenu, DropdownItem, DropdownTrigger, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, useDisclosure, Divider } from "@heroui/react";
import { ReactNode, useEffect, useState, useCallback, useMemo } from "react";
import { getProjectConfig, updateProjectName, updateWebhookUrl, createApiKey, deleteApiKey, listApiKeys, deleteProject, rotateSecret } from "../../../actions/project_actions";
import { updateMcpServers } from "../../../actions/mcp_actions";
import { CopyButton } from "../../../../components/common/copy-button";
import { EditableField } from "../../../lib/components/editable-field";
import { EyeIcon, EyeOffIcon, CopyIcon, MoreVerticalIcon, PlusIcon, EllipsisVerticalIcon, CheckCircleIcon, XCircleIcon } from "lucide-react";
import { WithStringId } from "../../../lib/types/types";
import { ApiKey } from "../../../lib/types/project_types";
import { z } from "zod";
import { RelativeTime } from "@primer/react";
import { Label } from "../../../lib/components/label";
import { ListItem } from "../../../lib/components/structured-list";
import { FormSection } from "../../../lib/components/form-section";
import { StructuredPanel } from "../../../lib/components/structured-panel";
import {
    ResizableHandle,
    ResizablePanel,
    ResizablePanelGroup,
} from "../../../../components/ui/resizable"
import { VoiceSection } from './components/voice';
import { ProjectSection } from './components/project';
import { ToolsSection } from './components/tools';
import { Panel } from "@/components/common/panel-common";
import { Settings, Wrench, Phone } from "lucide-react";
import { clsx } from "clsx";
import { USE_VOICE_FEATURE } from "@/app/lib/feature_flags";

export const metadata: Metadata = {
    title: "Project config",
};

export function Section({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return <div className="w-full flex flex-col gap-4 border border-border p-4 rounded-md">
        <h2 className="font-semibold pb-2 border-b border-border">{title}</h2>
        {children}
    </div>;
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

export function BasicSettingsSection({
    projectId,
}: {
    projectId: string;
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
    }

    return <Section title="Basic settings">
        <FormSection label="Project name">
            {loading && <Spinner size="sm" />}
            {!loading && <EditableField
                value={projectName || ''}
                onChange={updateName}
                className="w-full"
            />}
        </FormSection>

        <Divider />

        <FormSection label="Project ID">
            <div className="flex flex-row gap-2 items-center">
                <div className="text-gray-600 text-sm font-mono">{projectId}</div>
                <CopyButton
                    onCopy={() => {
                        navigator.clipboard.writeText(projectId);
                    }}
                    label="Copy"
                    successLabel="Copied"
                />
            </div>
        </FormSection>
    </Section>;
}

function McpServersSection({
    projectId,
}: {
    projectId: string;
}) {
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

    // Load initial servers
    useEffect(() => {
        setLoading(true);
        getProjectConfig(projectId).then((project) => {
            const initialServers = project.mcpServers || [];
            setServers(JSON.parse(JSON.stringify(initialServers))); // Deep copy
            setOriginalServers(JSON.parse(JSON.stringify(initialServers))); // Deep copy
            setLoading(false);
        });
    }, [projectId]);

    // Check if there are unsaved changes by comparing the arrays
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
        // Clear previous validation errors
        setValidationErrors({});
        
        const errors: typeof validationErrors = {};

        // Validate name uniqueness
        if (!newServer.name.trim()) {
            errors.name = 'Server name is required';
        } else if (servers.some(s => s.name === newServer.name)) {
            errors.name = 'Server name must be unique';
        }

        // Validate URL
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
            setOriginalServers(JSON.parse(JSON.stringify(servers))); // Update original servers after successful save
            setMessage({ type: 'success', text: 'Servers updated successfully' });
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            setMessage({ type: 'error', text: 'Failed to update servers' });
        }
        setSaving(false);
    };

    return <Section title="MCP servers">
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">
                    MCP серверы используются для выполнения MCP инструментов.
                </p>
                <Button
                    size="sm"
                    variant="flat"
                    startContent={<PlusIcon className="w-4 h-4" />}
                    onPress={handleAddServer}
                >
                    Добавить сервер
                </Button>
            </div>

            {loading ? (
                <Spinner size="sm" />
            ) : (
                <>
                    <div className="space-y-3">
                        {servers.map((server, index) => (
                            <div key={index} className="flex gap-3 items-center p-3 border border-border rounded-md">
                                <div className="flex-1">
                                    <div className="font-medium">{server.name}</div>
                                    <div className="text-sm text-muted-foreground">{server.url}</div>
                                </div>
                                <Button
                                    size="sm"
                                    color="danger"
                                    variant="light"
                                    onPress={() => handleRemoveServer(index)}
                                >
                                    Удалить
                                </Button>
                            </div>
                        ))}
                        {servers.length === 0 && (
                            <div className="text-center text-muted-foreground p-4">
                                Серверы не настроены
                            </div>
                        )}
                    </div>

                    {hasChanges && (
                        <div className="flex justify-end">
                            <Button
                                size="sm"
                                color="primary"
                                onPress={handleSave}
                                isLoading={saving}
                            >
                                Сохранить изменения
                            </Button>
                        </div>
                    )}

                    {message && (
                        <div className={`text-sm p-2 rounded-md ${
                            message.type === 'success' ? 'bg-green-50 text-green-500' : 'bg-red-50 text-red-500'
                        }`}>
                            {message.text}
                        </div>
                    )}
                </>
            )}

            <Modal isOpen={isOpen} onClose={onClose}>
                <ModalContent>
                    <ModalHeader>Добавить MCP сервер</ModalHeader>
                    <ModalBody>
                        <div className="flex flex-col gap-4">
                            <Input
                                label="Имя сервера"
                                placeholder="Введите имя сервера"
                                value={newServer.name}
                                onChange={(e) => {
                                    setNewServer({ ...newServer, name: e.target.value });
                                    // Clear name error when user types
                                    if (validationErrors.name) {
                                        setValidationErrors(prev => ({
                                            ...prev,
                                            name: undefined
                                        }));
                                    }
                                }}
                                errorMessage={validationErrors.name}
                                isInvalid={!!validationErrors.name}
                                isRequired
                            />
                            <Input
                                label="SSE URL"
                                placeholder="https://localhost:8000/sse"
                                value={newServer.url}
                                onChange={(e) => {
                                    setNewServer({ ...newServer, url: e.target.value });
                                    // Clear URL error when user types
                                    if (validationErrors.url) {
                                        setValidationErrors(prev => ({
                                            ...prev,
                                            url: undefined
                                        }));
                                    }
                                }}
                                errorMessage={validationErrors.url}
                                isInvalid={!!validationErrors.url}
                                isRequired
                            />
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="light" onPress={onClose}>
                            Отменить
                        </Button>
                        <Button
                            color="primary"
                            onPress={handleCreateServer}
                            isDisabled={!newServer.name || !newServer.url}
                        >
                            Добавить сервер
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    </Section>;
}

function ApiKeyDisplay({ apiKey }: { apiKey: string }) {
    const [isVisible, setIsVisible] = useState(false);

    const formattedKey = isVisible ? apiKey : `${apiKey.slice(0, 2)}${'•'.repeat(5)}${apiKey.slice(-2)}`;

    return (
        <div className="flex flex-col gap-1">
            <div className="text-sm font-mono break-all">{formattedKey}</div>
            <div className="flex flex-row gap-2 items-center">
                <button
                    onClick={() => setIsVisible(!isVisible)}
                    className="text-gray-300 hover:text-gray-700"
                >
                    {isVisible ? (
                        <EyeOffIcon className="w-4 h-4" />
                    ) : (
                        <EyeIcon className="w-4 h-4" />
                    )}
                </button>
                <CopyButton
                    onCopy={() => {
                        navigator.clipboard.writeText(apiKey);
                    }}
                    label="Копировать"
                    successLabel="Скопировано"
                />
            </div>
        </div>
    );
}

export function ApiKeysSection({
    projectId,
}: {
    projectId: string;
}) {
    const [keys, setKeys] = useState<WithStringId<z.infer<typeof ApiKey>>[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<{
        type: 'success' | 'error' | 'info';
        text: string;
    } | null>(null);

    useEffect(() => {
        const loadKeys = async () => {
            const keys = await listApiKeys(projectId);
            setKeys(keys);
            setLoading(false);
        };
        loadKeys();
    }, [projectId]);

    const handleCreateKey = async () => {
        setLoading(true);
        setMessage(null);
        try {
            const key = await createApiKey(projectId);
            setLoading(false);
            setMessage({
                type: 'success',
                text: 'API key created successfully',
            });
            setKeys([...keys, key]);

            setTimeout(() => {
                setMessage(null);
            }, 2000);
        } catch (error) {
            setLoading(false);
            setMessage({
                type: 'error',
                text: error instanceof Error ? error.message : "Failed to create API key",
            });
        }
    };

    const handleDeleteKey = async (id: string) => {
        if (!window.confirm("Are you sure you want to delete this API key? This action cannot be undone.")) {
            return;
        }

        try {
            setLoading(true);
            setMessage(null);
            await deleteApiKey(projectId, id);
            setKeys(keys.filter((k) => k._id !== id));
            setLoading(false);
            setMessage({
                type: 'info',
                text: 'API key deleted successfully',
            });
            setTimeout(() => {
                setMessage(null);
            }, 2000);
        } catch (error) {
            setLoading(false);
            setMessage({
                type: 'error',
                text: error instanceof Error ? error.message : "Failed to delete API key",
            });
        }
    };

    return <Section title="API ключи">
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">
                    API ключи используются для аутентификации запросов к API Agent Bulder.
                </p>
                <Button
                    onPress={handleCreateKey}
                    size="sm"
                    startContent={<PlusIcon className="w-4 h-4" />}
                    variant="flat"
                    isDisabled={loading}
                >
                    Создать API ключ
                </Button>
            </div>

            <Divider />
            {loading && <Spinner size="sm" />}
            {!loading && <div className="border border-border rounded-lg text-sm">
                <div className="flex items-center border-b border-border p-4">
                    <div className="flex-[3] font-normal">API ключ</div>
                    <div className="flex-1 font-normal">Создан</div>
                    <div className="flex-1 font-normal">Последний использован</div>
                    <div className="w-10"></div>
                </div>
                {message?.type === 'success' && <div className="flex flex-col p-2">
                    <div className="text-sm bg-green-50 text-green-500 p-2 rounded-md">{message.text}</div>
                </div>}
                {message?.type === 'error' && <div className="flex flex-col p-2">
                    <div className="text-sm bg-red-50 text-red-500 p-2 rounded-md">{message.text}</div>
                </div>}
                {message?.type === 'info' && <div className="flex flex-col p-2">
                    <div className="text-sm bg-yellow-50 text-yellow-500 p-2 rounded-md">{message.text}</div>
                </div>}
                <div className="flex flex-col">
                    {keys.map((key) => (
                        <div key={key._id} className="flex items-start border-b border-border last:border-b-0 p-4">
                            <div className="flex-[3] p-2">
                                <ApiKeyDisplay apiKey={key.key} />
                            </div>
                            <div className="flex-1 p-2">
                                <RelativeTime date={new Date(key.createdAt)} />
                            </div>
                            <div className="flex-1 p-2">
                                {key.lastUsedAt ? <RelativeTime date={new Date(key.lastUsedAt)} /> : 'Never'}
                            </div>
                            <div className="w-10 p-2">
                                <Dropdown>
                                    <DropdownTrigger>
                                        <button className="text-muted-foreground hover:text-foreground">
                                            <EllipsisVerticalIcon size={16} />
                                        </button>
                                    </DropdownTrigger>
                                    <DropdownMenu>
                                        <DropdownItem
                                            key='delete'
                                            className="text-destructive"
                                            onPress={() => handleDeleteKey(key._id)}
                                        >
                                            Удалить
                                        </DropdownItem>
                                    </DropdownMenu>
                                </Dropdown>
                            </div>
                        </div>
                    ))}
                    {keys.length === 0 && (
                        <div className="p-4 text-center text-muted-foreground">
                            API ключи не созданы
                        </div>
                    )}
                </div>
            </div>}
        </div>
    </Section>;
}

export function SecretSection({
    projectId,
}: {
    projectId: string;
}) {
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

    return <Section title="Secret">
        <p className="text-sm">
            Секрет проекта используется для подписи запросов на вызов инструментов, отправляемых в ваш вебхук
        </p>
        <Divider />
        <SectionRow>
            <LeftLabel label="Секрет проекта" />
            <RightContent>
                <div className="flex flex-row gap-2 items-center">
                    {loading && <Spinner size="sm" />}
                    {!loading && secret && <div className="flex flex-row gap-2 items-center">
                        <div className="text-gray-600 text-sm font-mono break-all">
                            {formattedSecret}
                        </div>
                        <button
                            onClick={() => setHidden(!hidden)}
                            className="text-gray-300 hover:text-gray-700 flex items-center gap-1 group"
                        >
                            {hidden ? <EyeIcon size={16} /> : <EyeOffIcon size={16} />}
                        </button>
                        <CopyButton
                            onCopy={() => {
                                navigator.clipboard.writeText(secret);
                            }}
                            label="Copy"
                            successLabel="Copied"
                        />
                        <Button
                            size="sm"
                            variant="flat"
                            color="warning"
                            onPress={handleRotateSecret}
                            isDisabled={loading}
                        >
                            Повернуть
                        </Button>
                    </div>}
                </div>
            </RightContent>
        </SectionRow>
    </Section>;
}

export function WebhookUrlSection({
    projectId,
}: {
    projectId: string;
}) {
    const [loading, setLoading] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        getProjectConfig(projectId).then((project) => {
            setWebhookUrl(project.webhookUrl || null);
            setLoading(false);
        });
    }, [projectId]);

    async function update(url: string) {
        setLoading(true);
        await updateWebhookUrl(projectId, url);
        setWebhookUrl(url);
        setLoading(false);
    }

    function validate(url: string) {
        try {
            new URL(url);
            return { valid: true };
        } catch {
            return { valid: false, errorMessage: 'Please enter a valid URL' };
        }
    }

    return <Section title="Webhook URL">
        <p className="text-sm">
            В редакторе рабочих процессов вызовы инструментов будут отправлены на этот URL, если они не имитируются.
        </p>
        <Divider />
        <FormSection label="URL вебхука">
            {loading && <Spinner size="sm" />}
            {!loading && <EditableField
                value={webhookUrl || ''}
                onChange={update}
                validate={validate}
                className="w-full"
            />}
        </FormSection>
    </Section>;
}

export function ChatWidgetSection({
    projectId,
    chatWidgetHost,
}: {
    projectId: string;
    chatWidgetHost: string;
}) {
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

    return <Section title="Chat widget">
        <p className="text-sm">
            Для использования виджета чата, скопируйте и вставьте этот код в самый конец тега &lt;/body&gt; вашего сайта:
        </p>
        {loading && <Spinner size="sm" />}
        {!loading && <Textarea
            variant="bordered"
            size="sm"
            defaultValue={code}
            className="max-w-full cursor-pointer font-mono"
            readOnly
            endContent={<CopyButton
                onCopy={() => {
                    navigator.clipboard.writeText(code);
                }}
                label="Copy"
                successLabel="Copied"
            />}
        />}
    </Section>;
}

export function DeleteProjectSection({
    projectId,
}: {
    projectId: string;
}) {
    const [loading, setLoading] = useState(false);
    const { isOpen, onOpen, onClose } = useDisclosure();
    const [projectName, setProjectName] = useState("");
    const [projectNameInput, setProjectNameInput] = useState("");
    const [confirmationInput, setConfirmationInput] = useState("");
    
    const isValid = projectNameInput === projectName && confirmationInput === "delete project";

    useEffect(() => {
        setLoading(true);
        getProjectConfig(projectId).then((project) => {
            setProjectName(project.name);
            setLoading(false);
        });
    }, [projectId]);

    const handleDelete = async () => {
        if (!isValid) return;
        setLoading(true);
        await deleteProject(projectId);
        setLoading(false);
    };

    return (
        <Section title="Delete project">
            {loading && <Spinner size="sm" />}
            {!loading && <div className="flex flex-col gap-4">
                <p className="text-sm">
                    Удаление проекта приведет к постоянному удалению всех связанных данных, включая рабочие процессы, источники и API ключи.
                    Это действие не может быть отменено.
                </p>
                <div>
                    <Button 
                        color="danger" 
                        size="sm"
                        onPress={onOpen}
                        isDisabled={loading}
                        isLoading={loading}
                    >
                        Удалить проект
                    </Button>
                </div>

                <Modal isOpen={isOpen} onClose={onClose}>
                    <ModalContent>
                        <ModalHeader>Удалить проект</ModalHeader>
                        <ModalBody>
                            <div className="flex flex-col gap-4">
                                <p>
                                    Это действие не может быть отменено. Пожалуйста, введите следующее для подтверждения:
                                </p>
                                <Input
                                    label="Имя проекта"
                                    placeholder={projectName}
                                    value={projectNameInput}
                                    onChange={(e) => setProjectNameInput(e.target.value)}
                                />
                                <Input
                                    label='Введите "delete project" для подтверждения'
                                    placeholder="delete project"
                                    value={confirmationInput}
                                    onChange={(e) => setConfirmationInput(e.target.value)}
                                />
                            </div>
                        </ModalBody>
                        <ModalFooter>
                            <Button variant="light" onPress={onClose}>
                                Отменить
                            </Button>
                            <Button 
                                color="danger" 
                                onPress={handleDelete}
                                isDisabled={!isValid}
                            >
                                Удалить проект
                            </Button>
                        </ModalFooter>
                    </ModalContent>
                </Modal>
            </div>}
        </Section>
    );
}

function NavigationMenu({ 
    selected, 
    onSelect 
}: { 
    selected: string;
    onSelect: (page: string) => void;
}) {
    const items = [
        { id: 'Project', icon: <Settings className="w-4 h-4" /> },
        { id: 'Tools', icon: <Wrench className="w-4 h-4" /> },
        ...(USE_VOICE_FEATURE ? [{ id: 'Voice', icon: <Phone className="w-4 h-4" /> }] : [])
    ];
    
    return (
        <Panel
            variant="projects"
            title={
                <div className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                    <Settings className="w-4 h-4" />
                    <span>Настройки</span>
                </div>
            }
        >
            <div className="flex flex-col">
                <div className="space-y-1 pb-2">
                    {items.map((item) => (
                        <div
                            key={item.id}
                            className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                            <button
                                className={clsx(
                                    "flex-1 flex items-center gap-2 text-sm text-left",
                                    selected === item.id 
                                        ? "text-zinc-900 dark:text-zinc-100" 
                                        : "text-zinc-600 dark:text-zinc-400"
                                )}
                                onClick={() => onSelect(item.id)}
                            >
                                {item.icon}
                                {item.id}
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </Panel>
    );
}

export function ConfigApp({
    projectId,
    useChatWidget,
    chatWidgetHost,
}: {
    projectId: string;
    useChatWidget: boolean;
    chatWidgetHost: string;
}) {
    const [selectedPage, setSelectedPage] = useState('Project');

    const renderContent = () => {
        switch (selectedPage) {
            case 'Project':
                return (
                    <div className="h-full overflow-auto p-6">
                        <Panel
                            variant="projects"
                            title={
                                <div className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                                    <Settings className="w-4 h-4" />
                                    <span>Настройки Проекта</span>
                                </div>
                            }
                        >
                            <div className="space-y-6">
                                <ProjectSection 
                                    projectId={projectId} 
                                    useChatWidget={useChatWidget} 
                                    chatWidgetHost={chatWidgetHost} 
                                />
                            </div>
                        </Panel>
                    </div>
                );
            case 'Tools':
                return (
                    <div className="h-full overflow-auto p-6">
                        <Panel
                            variant="projects"
                            title={
                                <div className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                                    <Wrench className="w-4 h-4" />
                                    <span>Настройки инструментов</span>
                                </div>
                            }
                        >
                            <div className="space-y-6">
                                <ToolsSection projectId={projectId} />
                            </div>
                        </Panel>
                    </div>
                );
            case 'Voice':
                return (
                    <div className="h-full overflow-auto p-6">
                        <Panel
                            variant="projects"
                            title={
                                <div className="font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                                    <Phone className="w-4 h-4" />
                                    <span>Настройки голоса</span>
                                </div>
                            }
                        >
                            <div className="space-y-6">
                                <VoiceSection projectId={projectId} />
                            </div>
                        </Panel>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <ResizablePanelGroup direction="horizontal" className="h-screen gap-1">
            <ResizablePanel minSize={10} defaultSize={15} className="p-6">
                <NavigationMenu 
                    selected={selectedPage}
                    onSelect={setSelectedPage}
                />
            </ResizablePanel>
            <ResizableHandle className="w-[3px] bg-transparent" />
            <ResizablePanel minSize={20} defaultSize={85}>
                {renderContent()}
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}

// Add default export
export default ConfigApp;