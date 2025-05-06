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
            setError("Введите название проекта.");
            return;
        }
        
        setError(null);
        updateProjectName(projectId, value);
    };

    return <Section 
        title="Название проекта"
        description="Как назвать проект?"
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
                        placeholder="Напиши название проекта..."
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
        title="Идентификатор проекта"
        description="Ваш уникальный идентификатор проекта."
    >
        <div className="flex flex-row gap-2 items-center">
            <div className="text-sm font-mono text-gray-600 dark:text-gray-400">{projectId}</div>
            <CopyButton
                onCopy={() => navigator.clipboard.writeText(projectId)}
                label="Копировать"
                successLabel="Скопировано"
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
        if (!confirm("Вы уверены, что хотите повернуть секрет? Все существующие подписи станут недействительными.")) {
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
        title="Секретный ключ"
        description="Ключ для безопасности запросов к вашему вебхуку. Не делитесь им."
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
                            label="Скопировать"
                            successLabel="Готово!"
                        />
                        <Button
                            size="sm"
                            variant="primary"
                            onClick={handleRotateSecret}
                            disabled={loading}
                        >
                            Обновить ключ
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
                text: 'API ключ успешно создан',
            });
            setTimeout(() => setMessage(null), 2000);
        } catch (error) {
            setMessage({
                type: 'error',
                text: error instanceof Error ? error.message : "Не удалось создать API ключ",
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteKey = async (id: string) => {
        if (!confirm("Удалить этот API-ключ? Восстановить не получится.")) {
            return;
        }

        try {
            setLoading(true);
            await deleteApiKey(projectId, id);
            setKeys(keys.filter((k) => k._id !== id));
            setMessage({
                type: 'info',
                text: 'API-ключ удалён',
            });
            setTimeout(() => setMessage(null), 2000);
        } catch (error) {
            setMessage({
                type: 'error',
                text: error instanceof Error ? error.message : "Не удалось удалить API-ключ",
            });
        } finally {
            setLoading(false);
        }
    };

    return <Section 
        title="API ключи"
        description="API ключи используются для аутентификации запросов к API Rowboat."
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
                    Создать API ключ
                </Button>
            </div>

            {loading ? (
                <Spinner size="sm" />
            ) : (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <div className="grid grid-cols-12 items-center border-b border-gray-200 dark:border-gray-700 p-4">
                        <div className="col-span-7 font-medium text-gray-900 dark:text-gray-100">API ключ</div>
                        <div className="col-span-3 font-medium text-gray-900 dark:text-gray-100">Создан</div>
                        <div className="col-span-2 font-medium text-gray-900 dark:text-gray-100">Последний использован</div>
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
                            Нет API ключей
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
            title="Чат-виджет"
            description="Добавьте чат на сайт — просто скопируйте этот код в <body>."
        >
            <div className="space-y-4">
                {loading ? (
                    <Spinner size="sm" />
                ) : (
                    <div className="relative">
                        <div className="absolute top-3 right-3">
                            <CopyButton
                                onCopy={() => navigator.clipboard.writeText(code)}
                                label="Скопировать"
                                successLabel="Готово!"
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
        <Section 
            title="Удалить проект"
            description="Удалит проект и все данные. Восстановить не получится."
        >
            <div className="space-y-4">
                <div className="p-4 bg-red-50/10 dark:bg-red-900/10 rounded-lg">
                    <p className="text-sm text-red-700 dark:text-red-300">
                        Удаление проекта приведет к постоянному удалению всех связанных данных, включая рабочие процессы, источники и API ключи.
                        Это действие не может быть отменено.
                    </p>
                </div>

                <Button 
                    variant="primary"
                    size="sm"
                    onClick={onOpen}
                    disabled={loading}
                    isLoading={loading}
                    color="red"
                >
                    Удалить проект
                </Button>

                <Modal isOpen={isOpen} onClose={onClose}>
                    <ModalContent>
                        <ModalHeader>Удалить проект</ModalHeader>
                        <ModalBody>
                            <div className="space-y-4">
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Чтобы удалить проект, введите его название и фразу:
                                </p>
                                <Input
                                    label="Название проекта"
                                    placeholder={projectName}
                                    value={projectNameInput}
                                    onChange={(e) => setProjectNameInput(e.target.value)}
                                />
                                <Input
                                    label='Введите "delete project"'
                                    placeholder="delete project"
                                    value={confirmationInput}
                                    onChange={(e) => setConfirmationInput(e.target.value)}
                                />
                            </div>
                        </ModalBody>
                        <ModalFooter>
                            <Button variant="secondary" onClick={onClose}>
                                Отменить
                            </Button>
                            <Button 
                                variant="primary"
                                color="danger"
                                onClick={handleDelete}
                                disabled={!isValid}
                            >
                                Удалить проект
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
