'use client';

import { useState, useEffect } from "react";
import { useParams } from 'next/navigation';
import { Spinner } from "@heroui/react";
import { getProjectConfig, updateWebhookUrl } from "@/app/actions/project_actions";
import { Textarea } from "@/components/ui/textarea";
import { clsx } from "clsx";

const sectionHeaderStyles = "text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2";
const sectionDescriptionStyles = "text-sm text-gray-500 dark:text-gray-400 mb-4";
const textareaStyles = "rounded-lg p-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 focus:shadow-inner focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20 placeholder:text-gray-400 dark:placeholder:text-gray-500";
const inputStyles = "rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 focus:shadow-inner focus:ring-2 focus:ring-indigo-500/20 dark:focus:ring-indigo-400/20";

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

export function WebhookConfig() {
    const params = useParams();
    const projectId = typeof params.projectId === 'string' ? params.projectId : params.projectId[0];
    
    const [loading, setLoading] = useState(true);
    const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;

        async function loadConfig() {
            try {
                const project = await getProjectConfig(projectId);
                if (mounted) {
                    setWebhookUrl(project.webhookUrl || null);
                    setError(null);
                }
            } catch (err) {
                if (mounted) {
                    console.error('Failed to load webhook URL:', err);
                    setError('Failed to load webhook URL');
                }
            } finally {
                if (mounted) {
                    setLoading(false);
                }
            }
        }

        loadConfig();

        return () => {
            mounted = false;
        };
    }, [projectId]);

    function validate(url: string) {
        if (!url.trim()) {
            return { valid: true };
        }
        try {
            new URL(url);
            setError(null);
            return { valid: true };
        } catch {
            setError('Please enter a valid URL');
            return { valid: false, errorMessage: 'Please enter a valid URL' };
        }
    }

    return (
        <div className="space-y-6">
            <Section 
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
                            disabled={loading}
                        />
                    </div>
                    {loading && (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            <Spinner size="sm" />
                            <span>Loading...</span>
                        </div>
                    )}
                    {error && (
                        <p className="text-sm text-red-500">{error}</p>
                    )}
                </div>
            </Section>
        </div>
    );
}

export default WebhookConfig; 