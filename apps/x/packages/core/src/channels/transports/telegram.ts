import type { z } from "zod";
import type { TelegramChannelStatus } from "@x/shared/dist/channels.js";
import type { ReplyFn } from "../bridge.js";

// Telegram Bot API transport. Deliberately dependency-free: the Bot API is
// plain HTTPS — getUpdates long polling (outbound connection, works behind
// NAT) plus sendMessage. The user supplies their own bot token (@BotFather).

const POLL_TIMEOUT_S = 50;
const RETRY_DELAY_MS = 5000;

type Status = z.infer<typeof TelegramChannelStatus>;

interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        text?: string;
        chat: { id: number; type: string };
        from?: { id: number; is_bot?: boolean };
    };
}

export interface TelegramTransportOptions {
    botToken: string;
    allowFrom: string[];
    onInbound: (senderKey: string, text: string, reply: ReplyFn) => void;
    onStatus: (status: Status) => void;
}

export class TelegramTransport {
    private abort: AbortController | null = null;
    private stopped = false;
    private offset = 0;

    constructor(private readonly opts: TelegramTransportOptions) {}

    async start(): Promise<void> {
        this.stopped = false;
        this.opts.onStatus({ state: "starting" });
        void this.run();
    }

    stop(): void {
        this.stopped = true;
        this.abort?.abort();
        this.opts.onStatus({ state: "disabled" });
    }

    private api(method: string): string {
        return `https://api.telegram.org/bot${this.opts.botToken}/${method}`;
    }

    private async call(method: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
        const res = await fetch(this.api(method), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            ...(signal ? { signal } : {}),
        });
        const payload = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
        if (!payload.ok) {
            throw new Error(payload.description ?? `Telegram API error (${method})`);
        }
        return payload.result;
    }

    private async run(): Promise<void> {
        // Validate the token up front so a typo surfaces in settings
        // immediately instead of as a silent poll loop failure.
        try {
            const me = (await this.call("getMe")) as { username?: string };
            if (this.stopped) return;
            this.opts.onStatus({ state: "polling", botUsername: me.username });
        } catch (error) {
            if (this.stopped) return;
            this.opts.onStatus({
                state: "error",
                error: error instanceof Error ? error.message : String(error),
            });
            return;
        }

        while (!this.stopped) {
            this.abort = new AbortController();
            try {
                const updates = (await this.call(
                    "getUpdates",
                    {
                        timeout: POLL_TIMEOUT_S,
                        offset: this.offset,
                        allowed_updates: ["message"],
                    },
                    this.abort.signal,
                )) as TelegramUpdate[];
                for (const update of updates) {
                    this.offset = Math.max(this.offset, update.update_id + 1);
                    this.handleUpdate(update);
                }
            } catch (error) {
                if (this.stopped) return;
                this.opts.onStatus({
                    state: "error",
                    error: error instanceof Error ? error.message : String(error),
                });
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
                if (this.stopped) return;
                this.opts.onStatus({ state: "polling" });
            }
        }
    }

    private handleUpdate(update: TelegramUpdate): void {
        const message = update.message;
        if (!message?.text || message.from?.is_bot) return;
        // DMs only: group chats would let any member drive the bridge.
        if (message.chat.type !== "private") return;
        const chatId = String(message.chat.id);
        const reply: ReplyFn = (text) => this.send(chatId, text);
        if (!this.opts.allowFrom.includes(chatId)) {
            void this.send(
                chatId,
                `⛔ Not authorized. Your chat ID is ${chatId} — add it under Rowboat → Settings → Mobile to pair this chat.`,
            ).catch(() => undefined);
            return;
        }
        this.opts.onInbound(`telegram:${chatId}`, message.text, reply);
    }

    private async send(chatId: string, text: string): Promise<void> {
        await this.call("sendMessage", { chat_id: chatId, text });
    }
}
