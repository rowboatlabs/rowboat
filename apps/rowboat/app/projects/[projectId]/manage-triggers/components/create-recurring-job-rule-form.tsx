'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/common/panel-common";
import { createRecurringJobRule } from "@/app/actions/recurring-job-rules.actions";
import { ArrowLeftIcon, PlusIcon, TrashIcon, InfoIcon } from "lucide-react";
import Link from "next/link";

// Define a simpler message type for the form that only includes the fields we need
type FormMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

const commonCronExamples = [
    { label: "Every minute", value: "* * * * *" },
    { label: "Every 5 minutes", value: "*/5 * * * *" },
    { label: "Every hour", value: "0 * * * *" },
    { label: "Every 2 hours", value: "0 */2 * * *" },
    { label: "Daily at midnight", value: "0 0 * * *" },
    { label: "Daily at 9 AM", value: "0 9 * * *" },
    { label: "Weekly on Sunday at midnight", value: "0 0 * * 0" },
    { label: "Monthly on the 1st at midnight", value: "0 0 1 * *" },
];

export function CreateRecurringJobRuleForm({ 
    projectId, 
    onBack 
}: { 
    projectId: string;
    onBack?: () => void;
}) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<FormMessage[]>([
        { role: "user", content: "" }
    ]);
    const [cronExpression, setCronExpression] = useState("* * * * *");
    const [showCronHelp, setShowCronHelp] = useState(false);

    const addMessage = () => {
        setMessages([...messages, { role: "user", content: "" }]);
    };

    const removeMessage = (index: number) => {
        if (messages.length > 1) {
            setMessages(messages.filter((_, i) => i !== index));
        }
    };

    const updateMessage = (index: number, field: keyof FormMessage, value: string) => {
        const newMessages = [...messages];
        newMessages[index] = { ...newMessages[index], [field]: value };
        setMessages(newMessages);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        // Validate required fields
        if (!cronExpression.trim()) {
            alert("Please enter a cron expression");
            return;
        }

        if (messages.some(msg => !msg.content?.trim())) {
            alert("Please fill in all message content");
            return;
        }

        setLoading(true);
        try {
            // Convert FormMessage to the expected Message type
            const convertedMessages = messages.map(msg => {
                if (msg.role === "assistant") {
                    return {
                        role: msg.role,
                        content: msg.content,
                        agentName: null,
                        responseType: "internal" as const,
                        timestamp: undefined
                    };
                }
                return {
                    role: msg.role,
                    content: msg.content,
                    timestamp: undefined
                };
            });
            
            await createRecurringJobRule({
                projectId,
                input: { messages: convertedMessages },
                cron: cronExpression,
            });
            if (onBack) {
                onBack();
            } else {
                router.push(`/projects/${projectId}/manage-triggers?tab=recurring`);
            }
        } catch (error) {
            console.error("Failed to create recurring job rule:", error);
            alert("Failed to create recurring job rule");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Panel
            title={
                <div className="flex items-center gap-3">
                    {onBack ? (
                        <Button 
                            variant="secondary" 
                            size="sm" 
                            startContent={<ArrowLeftIcon className="w-4 h-4" />} 
                            className="whitespace-nowrap"
                            onClick={onBack}
                        >
                            Back
                        </Button>
                    ) : (
                        <Link href={`/projects/${projectId}/manage-triggers?tab=recurring`}>
                            <Button variant="secondary" size="sm" startContent={<ArrowLeftIcon className="w-4 h-4" />} className="whitespace-nowrap">
                                Back
                            </Button>
                        </Link>
                    )}
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        CREATE RECURRING JOB RULE
                    </div>
                </div>
            }
        >
            <div className="h-full overflow-auto px-4 py-4">
                <div className="max-w-[800px] mx-auto">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Cron Expression */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Cron Expression *
                                </label>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setShowCronHelp(!showCronHelp)}
                                    className="p-1"
                                >
                                    <InfoIcon className="w-4 h-4" />
                                </Button>
                            </div>
                            
                            <input
                                type="text"
                                value={cronExpression}
                                onChange={(e) => setCronExpression(e.target.value)}
                                placeholder="* * * * *"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white font-mono"
                                required
                            />
                            
                            {showCronHelp && (
                                <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                                    <div className="text-sm text-blue-800 dark:text-blue-200 mb-2">
                                        <strong>Format:</strong> minute hour day month dayOfWeek
                                    </div>
                                    <div className="text-sm text-blue-700 dark:text-blue-300 mb-3">
                                        <strong>Examples:</strong>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {commonCronExamples.map((example, index) => (
                                            <div key={index} className="flex items-center gap-2">
                                                <code className="text-xs bg-blue-100 dark:bg-blue-800 px-2 py-1 rounded">
                                                    {example.value}
                                                </code>
                                                <span className="text-xs text-blue-600 dark:text-blue-300">
                                                    {example.label}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="text-xs text-blue-600 dark:text-blue-300 mt-2">
                                        <strong>Note:</strong> All times are in UTC timezone
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Messages */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                    Messages *
                                </label>
                                <Button
                                    type="button"
                                    onClick={addMessage}
                                    variant="secondary"
                                    size="sm"
                                    startContent={<PlusIcon className="w-4 h-4" />}
                                    className="whitespace-nowrap"
                                >
                                    Add Message
                                </Button>
                            </div>
                            
                            <div className="space-y-4">
                                {messages.map((message, index) => (
                                    <div key={index} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                                        <div className="flex items-center justify-between mb-3">
                                            <select
                                                value={message.role}
                                                onChange={(e) => updateMessage(index, "role", e.target.value)}
                                                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md text-sm dark:bg-gray-700 dark:text-white"
                                            >
                                                <option value="system">System</option>
                                                <option value="user">User</option>
                                                <option value="assistant">Assistant</option>
                                            </select>
                                            {messages.length > 1 && (
                                                <Button
                                                    type="button"
                                                    onClick={() => removeMessage(index)}
                                                    variant="secondary"
                                                    size="sm"
                                                    className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                                                >
                                                    <TrashIcon className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>
                                        <textarea
                                            value={message.content}
                                            onChange={(e) => updateMessage(index, "content", e.target.value)}
                                            placeholder={`Enter ${message.role} message...`}
                                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                                            rows={3}
                                            required
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Submit Button */}
                        <div className="flex justify-end">
                            <Button
                                type="submit"
                                disabled={loading}
                                isLoading={loading}
                                className="px-6 py-2 whitespace-nowrap"
                            >
                                {loading ? "Creating..." : "Create Rule"}
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </Panel>
    );
}
