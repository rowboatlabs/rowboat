'use client';

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/common/panel-common";
import { createScheduledJobRule, updateScheduledJobRule } from "@/app/actions/scheduled-job-rules.actions";
import { ArrowLeftIcon, PlusIcon, TrashIcon } from "lucide-react";
import Link from "next/link";
import { DatePicker } from "@heroui/react";
import { ZonedDateTime, now, getLocalTimeZone, parseAbsoluteToLocal } from "@internationalized/date";
import { z } from "zod";
import { Message } from "@/app/lib/types/types";
import { ScheduledJobRule } from "@/src/entities/models/scheduled-job-rule";

type FormMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

type BackButtonConfig =
    | { label: string; onClick: () => void }
    | { label: string; href: string };

type FormSubmitPayload = {
    messages: FormMessage[];
    scheduledDateTime: ZonedDateTime;
};

type ScheduledJobRuleFormBaseProps = {
    title: string;
    description?: string;
    submitLabel: string;
    submittingLabel: string;
    errorMessage: string;
    backButton?: BackButtonConfig;
    initialMessages?: FormMessage[];
    initialDateTime?: ZonedDateTime | null;
    placeholderDateTime: ZonedDateTime;
    minDateTime: ZonedDateTime;
    onSubmit: (payload: FormSubmitPayload) => Promise<unknown>;
    onSuccess?: (result: unknown) => void;
    successHref?: string;
};

const createEmptyMessage = (): FormMessage => ({ role: "user", content: "" });

const normaliseMessages = (messages?: FormMessage[]): FormMessage[] => {
    if (!messages || messages.length === 0) {
        return [createEmptyMessage()];
    }

    return messages.map((message) => ({ ...message }));
};

const convertFormMessagesToMessages = (messages: FormMessage[]): z.infer<typeof Message>[] => {
    return messages.map((msg) => {
        if (msg.role === "assistant") {
            return {
                role: msg.role,
                content: msg.content,
                agentName: null,
                responseType: "internal" as const,
                timestamp: undefined,
            };
        }

        return {
            role: msg.role,
            content: msg.content,
            timestamp: undefined,
        };
    });
};

function ScheduledJobRuleFormBase({
    title,
    description,
    submitLabel,
    submittingLabel,
    errorMessage,
    backButton,
    initialMessages,
    initialDateTime,
    placeholderDateTime,
    minDateTime,
    onSubmit,
    onSuccess,
    successHref,
}: ScheduledJobRuleFormBaseProps) {
    const router = useRouter();
    const [messages, setMessages] = useState<FormMessage[]>(normaliseMessages(initialMessages));
    const [scheduledDateTime, setScheduledDateTime] = useState<ZonedDateTime | null>(initialDateTime ?? placeholderDateTime);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setMessages(normaliseMessages(initialMessages));
    }, [initialMessages]);

    useEffect(() => {
        setScheduledDateTime(initialDateTime ?? placeholderDateTime);
    }, [initialDateTime, placeholderDateTime]);

    const addMessage = () => {
        setMessages((prev) => [...prev, createEmptyMessage()]);
    };

    const removeMessage = (index: number) => {
        setMessages((prev) => {
            if (prev.length <= 1) {
                return prev;
            }
            return prev.filter((_, i) => i !== index);
        });
    };

    const updateMessage = (index: number, field: keyof FormMessage, value: string) => {
        setMessages((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!scheduledDateTime) {
            alert("Please select date and time");
            return;
        }

        if (messages.some((msg) => !msg.content?.trim())) {
            alert("Please fill in all message content");
            return;
        }

        setLoading(true);
        try {
            const result = await onSubmit({
                messages,
                scheduledDateTime,
            });

            if (onSuccess) {
                onSuccess(result);
            } else if (successHref) {
                router.push(successHref);
            }
        } catch (error) {
            console.error(errorMessage, error);
            alert(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Panel
            title={
                <div className="flex items-center gap-3">
                    {backButton ? (
                        'onClick' in backButton ? (
                            <Button
                                variant="secondary"
                                size="sm"
                                startContent={<ArrowLeftIcon className="w-4 h-4" />}
                                className="whitespace-nowrap"
                                onClick={backButton.onClick}
                            >
                                {backButton.label}
                            </Button>
                        ) : (
                            <Link href={backButton.href}>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    startContent={<ArrowLeftIcon className="w-4 h-4" />}
                                    className="whitespace-nowrap"
                                >
                                    {backButton.label}
                                </Button>
                            </Link>
                        )
                    ) : null}
                    <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {title}
                        </div>
                        {description ? (
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {description}
                            </p>
                        ) : null}
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
                                placeholderValue={placeholderDateTime}
                                minValue={minDateTime}
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
                                {loading ? submittingLabel : submitLabel}
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </Panel>
    );
}

export function CreateScheduledJobRuleForm({ projectId, onBack, hasExistingTriggers = true }: { projectId: string; onBack?: () => void; hasExistingTriggers?: boolean }) {
    const timeZone = useMemo(() => getLocalTimeZone(), []);
    const minDateTime = useMemo(() => now(timeZone), [timeZone]);
    const defaultDateTime = useMemo(() => now(timeZone).add({ minutes: 30 }), [timeZone]);

    const handleSubmit = async ({ messages, scheduledDateTime }: FormSubmitPayload) => {
        const convertedMessages = convertFormMessagesToMessages(messages);
        const scheduledTimeString = scheduledDateTime.toDate().toISOString();

        await createScheduledJobRule({
            projectId,
            input: { messages: convertedMessages },
            scheduledTime: scheduledTimeString,
        });
    };

    const handleSuccess = onBack ? () => onBack() : undefined;
    const backButton: BackButtonConfig | undefined = hasExistingTriggers
        ? onBack
            ? { label: "Back", onClick: onBack }
            : { label: "Back", href: `/projects/${projectId}/manage-triggers?tab=scheduled` }
        : undefined;

    return (
        <ScheduledJobRuleFormBase
            title="CREATE SCHEDULED JOB RULE"
            description="Note: Triggers run only on the published version of your workflow. Publish any changes to make them active."
            submitLabel="Create Rule"
            submittingLabel="Creating..."
            errorMessage="Failed to create scheduled job rule"
            backButton={backButton}
            initialDateTime={defaultDateTime}
            placeholderDateTime={defaultDateTime}
            minDateTime={minDateTime}
            onSubmit={handleSubmit}
            onSuccess={handleSuccess}
            successHref={onBack ? undefined : `/projects/${projectId}/manage-triggers?tab=scheduled`}
        />
    );
}

export function EditScheduledJobRuleForm({
    projectId,
    rule,
    onCancel,
    onUpdated,
}: {
    projectId: string;
    rule: z.infer<typeof ScheduledJobRule>;
    onCancel: () => void;
    onUpdated?: (rule: z.infer<typeof ScheduledJobRule>) => void;
}) {
    const timeZone = useMemo(() => getLocalTimeZone(), []);
    const initialDateTime = useMemo(() => parseAbsoluteToLocal(rule.nextRunAt), [rule.nextRunAt]);
    const nowDateTime = useMemo(() => now(timeZone), [timeZone]);
    const minDateTime = useMemo(() => {
        return initialDateTime.compare(nowDateTime) < 0 ? initialDateTime : nowDateTime;
    }, [initialDateTime, nowDateTime]);

    const initialMessages = useMemo<FormMessage[]>(() => {
        return rule.input.messages
            .filter((message): message is Extract<z.infer<typeof Message>, { role: "system" | "user" | "assistant" }> => {
                return message.role === "system" || message.role === "user" || message.role === "assistant";
            })
            .map((message) => ({
                role: message.role,
                content: message.content ?? "",
            }));
    }, [rule.input.messages]);

    const handleSubmit = async ({ messages, scheduledDateTime }: FormSubmitPayload) => {
        const convertedMessages = convertFormMessagesToMessages(messages);
        const scheduledTimeString = scheduledDateTime.toDate().toISOString();

        const updatedRule = await updateScheduledJobRule({
            projectId,
            ruleId: rule.id,
            input: { messages: convertedMessages },
            scheduledTime: scheduledTimeString,
        });
        return updatedRule;
    };

    const handleSuccess = (result: unknown) => {
        if (result && typeof result === 'object' && onUpdated) {
            onUpdated(result as z.infer<typeof ScheduledJobRule>);
        }
        onCancel();
    };

    return (
        <ScheduledJobRuleFormBase
            title="EDIT SCHEDULED JOB RULE"
            description="Update the scheduled run time and prompt messages for this trigger."
            submitLabel="Save Changes"
            submittingLabel="Saving..."
            errorMessage="Failed to update scheduled job rule"
            backButton={{ label: "Cancel", onClick: onCancel }}
            initialMessages={initialMessages}
            initialDateTime={initialDateTime}
            placeholderDateTime={initialDateTime}
            minDateTime={minDateTime}
            onSubmit={handleSubmit}
            onSuccess={handleSuccess}
        />
    );
}
