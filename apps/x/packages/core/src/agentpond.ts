import { createFilesSpanExporterFromRuntimeEnv } from "@agentpond/files-sdk/otel";
import { OpenTelemetry } from "@ai-sdk/otel";
import {
    isOpenInferenceSpan,
    OpenInferenceBatchSpanProcessor,
} from "@arizeai/openinference-vercel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import type { TelemetryOptions } from "ai";

const AGENTPOND_TRACING_STATE = Symbol.for("rowboat.agentpond-tracing");

interface AgentPondTracingState {
    provider: NodeTracerProvider;
    telemetry: TelemetryOptions;
}

type AgentPondGlobal = typeof globalThis & {
    [AGENTPOND_TRACING_STATE]?: AgentPondTracingState;
};

function createAgentPondTracingState(): AgentPondTracingState | undefined {
    if (!process.env.FILES_SDK_PROVIDER) {
        return undefined;
    }

    try {
        const provider = new NodeTracerProvider({
            spanProcessors: [
                new OpenInferenceBatchSpanProcessor({
                    exporter: createFilesSpanExporterFromRuntimeEnv(),
                    spanFilter: isOpenInferenceSpan,
                    reparentOrphanedSpans: true,
                }),
            ],
        });

        return {
            provider,
            telemetry: {
                functionId: "rowboat-turn",
                integrations: [
                    new OpenTelemetry({
                        tracer: provider.getTracer("rowboat"),
                        usage: true,
                    }),
                    {
                        onEnd: flushAgentPondTracing,
                        onAbort: flushAgentPondTracing,
                        onError: flushAgentPondTracing,
                    },
                ],
                isEnabled: true,
                recordInputs: false,
                recordOutputs: false,
            },
        };
    } catch (error) {
        console.warn("[AgentPond] Failed to initialize tracing", error);
        return undefined;
    }
}

const agentPondGlobal = globalThis as AgentPondGlobal;
const tracingState = agentPondGlobal[AGENTPOND_TRACING_STATE]
    ?? (agentPondGlobal[AGENTPOND_TRACING_STATE] = createAgentPondTracingState());

export const agentPondTelemetry = tracingState?.telemetry;

export async function flushAgentPondTracing(): Promise<void> {
    try {
        await tracingState?.provider.forceFlush();
    } catch (error) {
        console.warn("[AgentPond] Failed to flush tracing", error);
    }
}
