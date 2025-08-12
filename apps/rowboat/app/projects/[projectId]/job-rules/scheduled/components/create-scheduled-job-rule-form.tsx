'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/common/panel-common";
import { createScheduledJobRule } from "@/app/actions/scheduled-job-rules.actions";
import { ArrowLeftIcon, PlusIcon, TrashIcon } from "lucide-react";
import Link from "next/link";
import { DatePicker } from "@heroui/react";
import { ZonedDateTime, now, getLocalTimeZone } from "@internationalized/date";

// Define a simpler message type for the form that only includes the fields we need
type FormMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

export function CreateScheduledJobRuleForm({ projectId }: { projectId: string }) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState<FormMessage[]>([
        { role: "user", content: "" }
    ]);
    // Set default to 30 minutes from now with timezone info
    const getDefaultDateTime = () => {
        const localTimeZone = getLocalTimeZone();
        const currentTime = now(localTimeZone);
        const thirtyMinutesFromNow = currentTime.add({ minutes: 30 });
        return thirtyMinutesFromNow;
    };

    const [scheduledDateTime, setScheduledDateTime] = useState<ZonedDateTime | null>(getDefaultDateTime());

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
        if (!scheduledDateTime) {
            alert("Please select date and time");
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
            
            // Convert ZonedDateTime to ISO string (already in UTC)
            const scheduledTimeString = scheduledDateTime.toDate().toISOString();
            
            await createScheduledJobRule({
                projectId,
                input: { messages: convertedMessages },
                scheduledTime: scheduledTimeString,
            });
            router.push(`/projects/${projectId}/job-rules`);
        } catch (error) {
            console.error("Failed to create scheduled job rule:", error);
            alert("Failed to create scheduled job rule");
        } finally {
            setLoading(false);
        }
    };



    return (
        <Panel
            title={
                <div className="flex items-center gap-3">
                    <Link href={`/projects/${projectId}/job-rules`}>
                        <Button variant="secondary" size="sm">
                            <ArrowLeftIcon className="w-4 h-4 mr-2" />
                            Back
                        </Button>
                    </Link>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        CREATE SCHEDULED JOB RULE
                    </div>
                </div>
            }
        >
            <div className="h-full overflow-auto px-4 py-4">
                <div className="max-w-[800px] mx-auto">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Scheduled Date & Time */}
                        <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Scheduled Date & Time *
                            </label>
                            <DatePicker
                                value={scheduledDateTime}
                                onChange={setScheduledDateTime}
                                placeholderValue={getDefaultDateTime()}
                                minValue={now(getLocalTimeZone())}
                                granularity="minute"
                                isRequired
                                className="w-full"
                            />
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
                                    className="flex items-center gap-2"
                                >
                                    <PlusIcon className="w-4 h-4" />
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
                                className="px-6 py-2"
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
