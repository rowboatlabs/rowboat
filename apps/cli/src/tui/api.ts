import { createParser } from "eventsource-parser";
import { Agent } from "../agents/agents.js";
import { AskHumanResponsePayload, Run, ToolPermissionAuthorizePayload } from "../runs/runs.js";
import { ListRunsResponse } from "../runs/repo.js";
import { ModelConfig } from "../models/models.js";
import { RunEvent } from "../entities/run-events.js";
import z from "zod";

const HealthSchema = z.object({
    status: z.literal("ok"),
});

const MessageResponse = z.object({
    messageId: z.string(),
});

const SuccessSchema = z.object({
    success: z.literal(true),
});

type RunEventType = z.infer<typeof RunEvent>;

export interface RowboatApiOptions {
    baseUrl?: string;
}

export class RowboatApi {
    readonly baseUrl: string;
    constructor({ baseUrl }: RowboatApiOptions = {}) {
        this.baseUrl = baseUrl ?? process.env.ROWBOATX_SERVER_URL ?? "http://127.0.0.1:3000";
    }

    private buildUrl(pathname: string): string {
        return new URL(pathname, this.baseUrl).toString();
    }

    private async request<T>(pathname: string, init?: RequestInit): Promise<T> {
        const headers: Record<string, string> = {
            Accept: "application/json",
        };
        if (init?.headers instanceof Headers) {
            init.headers.forEach((value, key) => {
                headers[key] = value;
            });
        } else if (Array.isArray(init?.headers)) {
            for (const [key, value] of init.headers) {
                headers[key] = value;
            }
        } else if (init?.headers) {
            Object.assign(headers, init.headers as Record<string, string>);
        }
        if (init?.body && !headers["Content-Type"]) {
            headers["Content-Type"] = "application/json";
        }
        const response = await fetch(this.buildUrl(pathname), {
            method: "GET",
            ...init,
            headers,
        });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`Request to ${pathname} failed (${response.status}): ${text || response.statusText}`);
        }
        if (response.status === 204) {
            return undefined as T;
        }
        const text = await response.text();
        if (!text) {
            return undefined as T;
        }
        return JSON.parse(text) as T;
    }

    async getHealth(): Promise<z.infer<typeof HealthSchema>> {
        const payload = await this.request("/health");
        return HealthSchema.parse(payload);
    }

    async getModelConfig(): Promise<z.infer<typeof ModelConfig>> {
        const payload = await this.request("/models");
        return ModelConfig.parse(payload);
    }

    async listAgents(): Promise<z.infer<typeof Agent>[]> {
        const payload = await this.request("/agents");
        return Agent.array().parse(payload);
    }

    async listRuns(cursor?: string): Promise<z.infer<typeof ListRunsResponse>> {
        const searchParams = new URLSearchParams();
        if (cursor) {
            searchParams.set("cursor", cursor);
        }
        const payload = await this.request(`/runs${searchParams.size ? `?${searchParams.toString()}` : ""}`);
        return ListRunsResponse.parse(payload);
    }

    async getRun(runId: string): Promise<z.infer<typeof Run>> {
        const payload = await this.request(`/runs/${encodeURIComponent(runId)}`);
        return Run.parse(payload);
    }

    async createRun(agentId: string): Promise<z.infer<typeof Run>> {
        const payload = await this.request("/runs/new", {
            method: "POST",
            body: JSON.stringify({ agentId }),
        });
        return Run.parse(payload);
    }

    async sendMessage(runId: string, message: string): Promise<z.infer<typeof MessageResponse>> {
        const payload = await this.request(`/runs/${encodeURIComponent(runId)}/messages/new`, {
            method: "POST",
            body: JSON.stringify({ message }),
        });
        return MessageResponse.parse(payload);
    }

    async authorizeTool(runId: string, payload: z.infer<typeof ToolPermissionAuthorizePayload>): Promise<void> {
        const response = await this.request(`/runs/${encodeURIComponent(runId)}/permissions/authorize`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
        SuccessSchema.parse(response);
    }

    async replyToHuman(runId: string, requestId: string, payload: z.infer<typeof AskHumanResponsePayload>): Promise<void> {
        const response = await this.request(`/runs/${encodeURIComponent(runId)}/human-input-requests/${encodeURIComponent(requestId)}/reply`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
        SuccessSchema.parse(response);
    }

    async stopRun(runId: string): Promise<void> {
        const response = await this.request(`/runs/${encodeURIComponent(runId)}/stop`, {
            method: "POST",
        });
        SuccessSchema.parse(response);
    }

    async subscribeToEvents(onEvent: (event: RunEventType) => void, onError?: (error: Error) => void): Promise<() => void> {
        const controller = new AbortController();
        const response = await fetch(this.buildUrl("/stream"), {
            method: "GET",
            headers: {
                Accept: "text/event-stream",
            },
            signal: controller.signal,
        });
        if (!response.ok || !response.body) {
            throw new Error(`Failed to subscribe to event stream (${response.status})`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = createParser((event) => {
            if (event.type !== "event" || !event.data) {
                return;
            }
            try {
                const parsed = RunEvent.parse(JSON.parse(event.data));
                onEvent(parsed);
            } catch (error) {
                onError?.(error instanceof Error ? error : new Error(String(error)));
            }
        });

        (async () => {
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) {
                        break;
                    }
                    parser.feed(decoder.decode(value, { stream: true }));
                }
            } catch (error) {
                if (controller.signal.aborted) {
                    return;
                }
                onError?.(error instanceof Error ? error : new Error(String(error)));
            }
        })();

        return () => {
            controller.abort();
            reader.cancel().catch(() => undefined);
        };
    }
}
