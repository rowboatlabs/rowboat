'use client';

import { Metadata } from "next";
import { Spinner, Dropdown, DropdownMenu, DropdownItem, DropdownTrigger, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, useDisclosure, Divider, Textarea } from "@heroui/react";
import { Button } from "@/components/ui/button";
import { ReactNode, useEffect, useState } from "react";
import { fetchProject, updateProjectName, updateWebhookUrl, deleteProject, rotateSecret } from "../../../actions/project.actions";
import { CopyButton } from "../../../../components/common/copy-button";
import { InputField } from "../../../lib/components/input-field";
import { EyeIcon, EyeOffIcon, Settings, Plus, MoreVertical } from "lucide-react";
import { Label } from "../../../lib/components/label";
import { FormSection } from "../../../lib/components/form-section";
import { Panel } from "@/components/common/panel-common";
import { ProjectSection, SimpleProjectSection } from './components/project';

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
    return <div className="w-full flex flex-col gap-4 border border p-4 rounded-md">
        <h2 className="font-semibold pb-2 border-b border">{title}</h2>
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
        fetchProject(projectId).then((project) => {
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
            {!loading && <InputField type="text"
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
        fetchProject(projectId).then((project) => {
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
            The project secret is used for signing tool-call requests sent to your webhook
        </p>
        <Divider />
        <SectionRow>
            <LeftLabel label="Project secret" />
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
                            variant="primary"
                            color="warning"
                            onClick={handleRotateSecret}
                            disabled={loading}
                        >
                            Rotate
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
        fetchProject(projectId).then((project) => {
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
            In workflow editor, tool calls will be posted to this URL, unless they are mocked.
        </p>
        <Divider />
        <FormSection label="Webhook URL">
            {loading && <Spinner size="sm" />}
            {!loading && <InputField type="text"
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
        fetchProject(projectId).then((project) => {
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
            To use the chat widget, copy and paste this code snippet just before the closing &lt;/body&gt; tag of your website:
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
        fetchProject(projectId).then((project) => {
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
                    Deleting a project will permanently remove all associated data, including workflows, sources, and API keys.
                    This action cannot be undone.
                </p>
                <div>
                    <Button
                        color="danger"
                        size="sm"
                        onClick={onOpen}
                        disabled={loading}
                    >
                        Delete project
                    </Button>
                </div>

                <Modal isOpen={isOpen} onClose={onClose}>
                    <ModalContent>
                        <ModalHeader>Delete Project</ModalHeader>
                        <ModalBody>
                            <div className="flex flex-col gap-4">
                                <p>
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
                            </div>
                        </ModalBody>
                        <ModalFooter>
                            <Button variant="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                color="danger"
                                onClick={handleDelete}
                                disabled={!isValid}
                            >
                                Delete Project
                            </Button>
                        </ModalFooter>
                    </ModalContent>
                </Modal>
            </div>}
        </Section>
    );
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
                    label="Copy"
                    successLabel="Copied"
                />
            </div>
        </div>
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
    return (
        <div className="h-full overflow-auto p-6">
            <Panel title="Project settings">
                <ProjectSection
                    projectId={projectId}
                    useChatWidget={useChatWidget}
                    chatWidgetHost={chatWidgetHost}
                />
            </Panel>
        </div>
    );
}

export function SimpleConfigApp({
    projectId,
    onProjectConfigUpdated,
}: {
    projectId: string;
    onProjectConfigUpdated?: () => void;
}) {
    return (
        <div className="h-full overflow-auto p-6">
            <Panel title="Project Settings">
                <SimpleProjectSection
                    projectId={projectId}
                    onProjectConfigUpdated={onProjectConfigUpdated}
                />
            </Panel>
        </div>
    );
}

// Add default export
export default ConfigApp;