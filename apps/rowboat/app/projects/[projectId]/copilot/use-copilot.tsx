import { useCallback, useRef, useState } from "react";
import { getCopilotResponseStream } from "@/app/actions/copilot_actions";
import { CopilotMessage } from "@/app/lib/types/copilot_types";
import { Workflow } from "@/app/lib/types/workflow_types";
import { DataSource } from "@/app/lib/types/datasource_types";
import { z } from "zod";
import { WithStringId } from "@/app/lib/types/types";

interface UseCopilotParams {
    projectId: string;
    workflow: z.infer<typeof Workflow>;
    context: any;
    dataSources?: WithStringId<z.infer<typeof DataSource>>[];
}

interface UseCopilotResult {
    streamingResponse: string;
    loading: boolean;
    error: string | null;
    clearError: () => void;
    billingError: string | null;
    clearBillingError: () => void;
    start: (
        messages: z.infer<typeof CopilotMessage>[],
        onDone: (finalResponse: string) => void,
    ) => void;
    cancel: () => void;
}

export function useCopilot({ projectId, workflow, context, dataSources }: UseCopilotParams): UseCopilotResult {
    const [streamingResponse, setStreamingResponse] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [billingError, setBillingError] = useState<string | null>(null);
    const cancelRef = useRef<() => void>(() => { });
    const responseRef = useRef('');

    function clearError() {
        setError(null);
    }

    function clearBillingError() {
        setBillingError(null);
    }

    const start = useCallback(async (
        messages: z.infer<typeof CopilotMessage>[],
        onDone: (finalResponse: string) => void,
    ) => {
        if (!messages.length || messages.at(-1)?.role !== 'user') return;

        setStreamingResponse('');
        responseRef.current = '';
        setError(null);
        setLoading(true);

        try {
            const res = await getCopilotResponseStream(projectId, messages, workflow, context || null, dataSources);
            
            // Check for billing error
            if ('billingError' in res) {
                setLoading(false);
                setError(res.billingError);
                setBillingError(res.billingError);
                return;
            }

            const eventSource = new EventSource(`/api/copilot-stream-response/${res.streamId}`);

            eventSource.onmessage = (event) => {
                try {
                    const { content } = JSON.parse(event.data);
                    responseRef.current += content;
                    setStreamingResponse(prev => prev + content);
                } catch (e) {
                    setError('Failed to parse stream message');
                }
            };

            eventSource.addEventListener('done', () => {
                eventSource.close();
                setLoading(false);
                onDone(responseRef.current);
            });

            eventSource.onerror = () => {
                eventSource.close();
                setError('Streaming failed');
                setLoading(false);
            };

            cancelRef.current = () => eventSource.close();
        } catch (err) {
            setError('Failed to initiate stream');
            setLoading(false);
        }
    }, [projectId, workflow, context, dataSources]);

    const cancel = useCallback(() => {
        cancelRef.current?.();
        setLoading(false);
    }, []);

    return {
        streamingResponse,
        loading,
        error,
        clearError,
        billingError,
        clearBillingError,
        start,
        cancel,
    };
}
