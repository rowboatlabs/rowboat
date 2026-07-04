import fs from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type { TelegramChannelStatus } from "@x/shared/dist/channels.js";

// Telegram Bot API transport. Deliberately dependency-free: the Bot API is
// plain HTTPS — getUpdates long polling (outbound connection, works behind
// NAT) plus sendMessage. The user supplies their own bot token (@BotFather).
//
// The getUpdates offset is persisted to disk after each processed batch:
// Telegram only marks updates confirmed when a LATER getUpdates call passes a
// higher offset, so without persistence every transport restart (app relaunch
// or settings save) would redeliver — and re-execute — the last batch.

const POLL_TIMEOUT_S = 50;
const RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 60_000;

type Status = z.infer<typeof TelegramChannelStatus>;

class TelegramApiError extends Error {
    constructor(
        message: string,
        readonly code?: number,
    ) {
        super(message);
        this.name = "TelegramApiError";
    }
}

// 401 = token revoked/invalid, 404 = bot deleted / malformed token. Retrying
// these forever would hammer the API and show a misleading "polling" status.
function isTerminal(error: unknown): boolean {
    return error instanceof TelegramApiError && (error.code === 401 || error.code === 404);
}

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
    // JSON file holding { offset } across restarts.
    stateFile: string;
    // chatId is the address to reply to; the caller owns reply routing.
    onInbound: (senderKey: string, chatId: string, text: string) => void;
    onStatus: (status: Status) => void;
}

export class TelegramTransport {
    private abort: AbortController | null = null;
    private stopped = false;
    private offset = 0;
    private botUsername: string | undefined;

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

    private async call(method: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
        const res = await fetch(`https://api.telegram.org/bot${this.opts.botToken}/${method}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            ...(signal ? { signal } : {}),
        });
        const payload = (await res.json()) as {
            ok: boolean;
            result?: unknown;
            description?: string;
            error_code?: number;
        };
        if (!payload.ok) {
            throw new TelegramApiError(
                payload.description ?? `Telegram API error (${method})`,
                payload.error_code,
            );
        }
        return payload.result;
    }

    private async loadOffset(): Promise<void> {
        try {
            const raw = await fs.readFile(this.opts.stateFile, "utf8");
            const parsed = JSON.parse(raw) as { offset?: unknown };
            if (typeof parsed.offset === "number" && Number.isFinite(parsed.offset)) {
                this.offset = parsed.offset;
            }
        } catch {
            // first run or unreadable state — start from 0
        }
    }

    private async saveOffset(): Promise<void> {
        try {
            await fs.mkdir(path.dirname(this.opts.stateFile), { recursive: true });
            await fs.writeFile(this.opts.stateFile, JSON.stringify({ offset: this.offset }));
        } catch {
            // best effort — worst case is one redelivered batch after restart
        }
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async run(): Promise<void> {
        await this.loadOffset();

        // Validate the token, retrying transient failures (the app often
        // starts at login before the network is up). Only a definitive
        // API rejection is terminal.
        let delay = RETRY_DELAY_MS;
        while (!this.stopped) {
            try {
                const me = (await this.call("getMe")) as { username?: string };
                if (this.stopped) return;
                this.botUsername = me.username;
                this.opts.onStatus({ state: "polling", botUsername: me.username });
                break;
            } catch (error) {
                if (this.stopped) return;
                const message = error instanceof Error ? error.message : String(error);
                if (isTerminal(error)) {
                    this.opts.onStatus({
                        state: "error",
                        error: `Bot token rejected (${message}) — create a new token with @BotFather.`,
                    });
                    return;
                }
                this.opts.onStatus({ state: "error", error: message });
                await this.sleep(delay);
                delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
            }
        }

        delay = RETRY_DELAY_MS;
        let healthy = true;
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
                    this.offset = update.update_id + 1;
                    this.handleUpdate(update);
                }
                if (updates.length > 0) {
                    await this.saveOffset();
                }
                if (!healthy) {
                    // Restore the healthy status only after a successful poll.
                    healthy = true;
                    this.opts.onStatus({ state: "polling", botUsername: this.botUsername });
                }
                delay = RETRY_DELAY_MS;
            } catch (error) {
                if (this.stopped) return;
                const message = error instanceof Error ? error.message : String(error);
                if (isTerminal(error)) {
                    this.opts.onStatus({
                        state: "error",
                        error: `Bot token rejected (${message}) — create a new token with @BotFather.`,
                    });
                    return;
                }
                healthy = false;
                this.opts.onStatus({ state: "error", error: message });
                await this.sleep(delay);
                delay = Math.min(delay * 2, MAX_RETRY_DELAY_MS);
            }
        }
    }

    private handleUpdate(update: TelegramUpdate): void {
        const message = update.message;
        if (!message?.text || message.from?.is_bot) return;
        // DMs only: group chats would let any member drive the bridge.
        if (message.chat.type !== "private") return;
        const chatId = String(message.chat.id);
        if (!this.opts.allowFrom.includes(chatId)) {
            void this.send(
                chatId,
                `⛔ Not authorized. Your chat ID is ${chatId} — add it under Rowboat → Settings → Mobile to pair this chat.`,
            ).catch(() => undefined);
            return;
        }
        this.opts.onInbound(`telegram:${chatId}`, chatId, message.text);
    }

    async send(chatId: string, text: string): Promise<void> {
        await this.call("sendMessage", { chat_id: chatId, text });
    }
}
