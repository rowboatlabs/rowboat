'use client';

import { useState, useEffect } from "react";
import { Spinner, Button, Input } from "@heroui/react";
import { fetchProject, updateWebhookUrl } from "@/app/actions/project.actions";
import { clsx } from "clsx";
import { ProjectWideChangeConfirmationModal } from '@/components/common/project-wide-change-confirmation-modal';

export function WebhookConfig({ projectId }: { projectId: string }) {
    
    const [loading, setLoading] = useState(true);
    const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [editValue, setEditValue] = useState<string>('');

    useEffect(() => {
        let mounted = true;

        async function loadConfig() {
            try {
                const project = await fetchProject(projectId);
                if (mounted) {
                    setWebhookUrl(project.webhookUrl || null);
                    setEditValue(project.webhookUrl || '');
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

    // validate on change in webhook
    useEffect(() => {
        if (!isEditMode) return;
        
        setError(null);
        try {
            new URL(editValue || '');
        } catch {
            setError('Please enter a valid URL');
        }
    }, [editValue, isEditMode]);

    const handleEdit = () => {
        setIsEditMode(true);
        setEditValue(webhookUrl || '');
        setError(null);
    };

    const handleCancel = () => {
        setIsEditMode(false);
        setEditValue(webhookUrl || '');
        setError(null);
    };

    async function handleSave() {
        setSaving(true);
        try {
            await updateWebhookUrl(projectId, editValue);
            setWebhookUrl(editValue);
            setIsEditMode(false);
            setShowConfirmModal(false);
        } catch (err) {
            console.error('Failed to update webhook URL:', err);
            setError('Failed to update webhook URL');
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
                    <div className="px-6 pt-4">
                        <h2 className="block text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Webhook URL</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">In workflow editor, tool calls will be posted to this URL, unless they are mocked.</p>
                    </div>
                    <div className="px-6 pb-6">
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            <Spinner size="sm" />
                            <span>Loading...</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
                <div className="px-6 pt-4">
                    <h2 className="block text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Webhook URL</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Tool calls will be posted to this URL, unless they are mocked.</p>
                </div>
                <div className="px-6 pb-6">
                    <div className="space-y-4">
                        {isEditMode ? (
                            <>
                                <div className={clsx(
                                    "border rounded-lg focus-within:ring-2",
                                    error 
                                        ? "border-red-500 focus-within:ring-red-500/20" 
                                        : "border-gray-200 dark:border-gray-700 focus-within:ring-indigo-500/20 dark:focus-within:ring-indigo-400/20"
                                )}>
                                    <Input
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        placeholder="Enter webhook URL..."
                                        className="w-full text-sm bg-transparent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-colors px-4 py-3"
                                    />
                                </div>
                                {error && (
                                    <p className="text-sm text-red-500">{error}</p>
                                )}
                                <div className="flex gap-2 justify-end">
                                    <Button
                                        variant="light"
                                        onPress={handleCancel}
                                        disabled={saving}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        color="primary"
                                        onPress={() => setShowConfirmModal(true)}
                                        disabled={!!error || saving}
                                    >
                                        Update Webhook URL
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="flex items-center justify-between">
                                    <div className="flex-1">
                                        <p className="text-sm text-gray-600 dark:text-gray-400">
                                            {webhookUrl || 'No webhook URL configured'}
                                        </p>
                                    </div>
                                    <Button
                                        variant="light"
                                        onPress={handleEdit}
                                    >
                                        Edit
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <ProjectWideChangeConfirmationModal
                isOpen={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                onConfirm={handleSave}
                title="Update Webhook URL"
                confirmationQuestion="Are you sure you want to update the webhook URL? This will affect all workflow tool calls."
                confirmButtonText="Update"
                isLoading={saving}
            />
        </div>
    );
}

export default WebhookConfig; 