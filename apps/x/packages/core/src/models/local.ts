import { wrapLanguageModel, type LanguageModel } from "ai";
import type { z } from "zod";
import type { LlmProvider } from "@x/shared/dist/models.js";
import { PrefixLogger } from "@x/shared";

const log = new PrefixLogger("LocalLlm");

// Ollama's server-side default context window (~4k tokens) is far below what
// Rowboat's agents need (the copilot's system prompt + tool schemas alone are
// ~15-20k tokens) and Ollama silently truncates the prompt from the top when
// it overflows — the model loses its own instructions. We therefore always
// request an explicit window for Ollama models. Overridable per provider via
// `contextLength` in models.json.
export const DEFAULT_OLLAMA_CONTEXT_LENGTH = 32768;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/**
 * Whether requests to this provider are served by a model running on the
 * user's own machine (and therefore need scheduling: local runtimes process
 * requests mostly serially, so background work must not starve chat).
 */
export function isLocalProvider(config: z.infer<typeof LlmProvider>): boolean {
    if (config.flavor === "ollama") {
        return true;
    }
    if (config.flavor === "openai-compatible") {
        // LM Studio, llama.cpp server, vLLM on the same machine, etc.
        try {
            const host = new URL(config.baseURL ?? "").hostname;
            return LOOPBACK_HOSTS.has(host) || host.endsWith(".local");
        } catch {
            return false;
        }
    }
    return false;
}

export type LlmPriority = "interactive" | "classifier" | "background";

const PRIORITY_ORDER: Record<LlmPriority, number> = {
    interactive: 0,
    classifier: 1,
    background: 2,
};

interface Waiter {
    priority: LlmPriority;
    seq: number;
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
}

function abortError(): Error {
    const error = new Error("local LLM slot acquisition aborted");
    error.name = "AbortError";
    return error;
}

/**
 * Serializes access to local LLM runtimes. One slot by default: local servers
 * effectively process one request at a time, and interleaving requests
 * destroys their KV-cache reuse. Waiters are served strictly by priority
 * (interactive chat > lightweight classifiers > background knowledge
 * pipeline), FIFO within a priority — so a queued email-labeling job can
 * never delay the user's chat by more than the one request already running.
 */
export class LocalLlmScheduler {
    private active = 0;
    private seq = 0;
    private readonly waiting: Waiter[] = [];

    constructor(private readonly maxConcurrent = 1) {}

    async acquire(priority: LlmPriority, signal?: AbortSignal): Promise<() => void> {
        if (signal?.aborted) {
            throw abortError();
        }
        if (this.active < this.maxConcurrent) {
            this.active++;
            return this.makeRelease();
        }
        return new Promise<() => void>((resolve, reject) => {
            const waiter: Waiter = { priority, seq: this.seq++, resolve, reject, signal };
            if (signal) {
                waiter.onAbort = () => {
                    const index = this.waiting.indexOf(waiter);
                    if (index >= 0) {
                        this.waiting.splice(index, 1);
                        reject(abortError());
                    }
                };
                signal.addEventListener("abort", waiter.onAbort, { once: true });
            }
            this.waiting.push(waiter);
            if (this.waiting.length === 1 || this.waiting.length % 10 === 0) {
                log.log(`queueing ${priority} request (${this.waiting.length} waiting, ${this.active} active)`);
            }
        });
    }

    /** Run `fn` while holding a slot. */
    async run<T>(priority: LlmPriority, signal: AbortSignal | undefined, fn: () => PromiseLike<T>): Promise<T> {
        const release = await this.acquire(priority, signal);
        try {
            return await fn();
        } finally {
            release();
        }
    }

    get queueDepth(): number {
        return this.waiting.length;
    }

    private makeRelease(): () => void {
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            this.active--;
            this.dequeue();
        };
    }

    private dequeue(): void {
        while (this.active < this.maxConcurrent && this.waiting.length > 0) {
            let best = 0;
            for (let i = 1; i < this.waiting.length; i++) {
                const a = this.waiting[i];
                const b = this.waiting[best];
                if (
                    PRIORITY_ORDER[a.priority] < PRIORITY_ORDER[b.priority] ||
                    (PRIORITY_ORDER[a.priority] === PRIORITY_ORDER[b.priority] && a.seq < b.seq)
                ) {
                    best = i;
                }
            }
            const [waiter] = this.waiting.splice(best, 1);
            if (waiter.signal && waiter.onAbort) {
                waiter.signal.removeEventListener("abort", waiter.onAbort);
            }
            this.active++;
            waiter.resolve(this.makeRelease());
        }
    }
}

function envConcurrency(): number {
    const raw = process.env.ROWBOAT_LOCAL_LLM_CONCURRENCY;
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

// One queue for all local providers: users run one local server, and even
// with several, the machine's compute is the shared resource.
export const localLlmScheduler = new LocalLlmScheduler(envConcurrency());

/**
 * Wrap a language model so every call requests an explicit context window
 * from Ollama (merged under the caller's providerOptions — an explicit
 * caller value wins) and, when `priority` is set and the provider is local,
 * goes through the shared scheduler.
 */
export function applyLocalModelSettings(
    model: LanguageModel,
    providerConfig: z.infer<typeof LlmProvider>,
    priority: LlmPriority | null,
): LanguageModel {
    if (typeof model === "string") {
        // Bare model-id strings resolve through the global registry; local
        // providers never take this path.
        return model;
    }
    const local = isLocalProvider(providerConfig);
    const wantsNumCtx = providerConfig.flavor === "ollama";
    if (!wantsNumCtx && !(local && priority)) {
        return model;
    }
    const numCtx = providerConfig.contextLength ?? DEFAULT_OLLAMA_CONTEXT_LENGTH;
    const schedule = local && priority ? priority : null;
    return wrapLanguageModel({
        model,
        middleware: {
            ...(wantsNumCtx
                ? {
                      transformParams: async ({ params }) => {
                          const providerOptions = (params.providerOptions ?? {}) as Record<string, Record<string, unknown>>;
                          const ollama = (providerOptions.ollama ?? {}) as Record<string, unknown>;
                          const options = (ollama.options ?? {}) as Record<string, unknown>;
                          return {
                              ...params,
                              providerOptions: {
                                  ...providerOptions,
                                  ollama: {
                                      ...ollama,
                                      options: { num_ctx: numCtx, ...options },
                                  },
                              },
                          };
                      },
                  }
                : {}),
            ...(schedule
                ? {
                      wrapGenerate: async ({ doGenerate, params }) =>
                          localLlmScheduler.run(schedule, params.abortSignal, () => doGenerate()),
                      wrapStream: async ({ doStream, params }) => {
                          const release = await localLlmScheduler.acquire(schedule, params.abortSignal);
                          try {
                              const { stream, ...rest } = await doStream();
                              return { ...rest, stream: releaseOnSettled(stream, release) };
                          } catch (error) {
                              release();
                              throw error;
                          }
                      },
                  }
                : {}),
        },
    });
}

// Hold the slot until the provider stream drains, errors, or is cancelled —
// a streaming response occupies the local server for its full duration.
function releaseOnSettled<T>(stream: ReadableStream<T>, release: () => void): ReadableStream<T> {
    const reader = stream.getReader();
    return new ReadableStream<T>({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    release();
                    controller.close();
                } else {
                    controller.enqueue(value);
                }
            } catch (error) {
                release();
                controller.error(error);
            }
        },
        cancel(reason) {
            release();
            return reader.cancel(reason);
        },
    });
}
