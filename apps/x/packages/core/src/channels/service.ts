import path from "node:path";
import fs from "node:fs/promises";
import type { z } from "zod";
import type { ChannelsConfig, ChannelsStatus } from "@x/shared/dist/channels.js";
import container from "../di/container.js";
import { WorkDir } from "../config/config.js";
import type { ISessions } from "../sessions/api.js";
import type { ITurnEventBus } from "../turns/event-hub.js";
import { isSignedIn } from "../account/account.js";
import { listGatewayModels } from "../models/gateway.js";
import { listOnboardingModels } from "../models/models-dev.js";
import { ChannelBridge, type ModelChoice } from "./bridge.js";
import type { IChannelsConfigRepo } from "./repo.js";
import { TelegramTransport } from "./transports/telegram.js";
// Type-only: the real module (which pulls the ~9MB baileys dependency) is
// loaded dynamically in startWhatsApp, so boot pays nothing while disabled.
import type { WhatsAppTransport } from "./transports/whatsapp.js";

// Lifecycle owner for the mobile channels: reads config, runs the enabled
// transports against one shared ChannelBridge, and fans status out to the
// renderer (QR pairing, connection state). init() from main after
// sessions.initialize(); applyChannelsConfig() on every settings save.

type Config = z.infer<typeof ChannelsConfig>;
type Status = z.infer<typeof ChannelsStatus>;

const WHATSAPP_AUTH_DIR = path.join(WorkDir, "channels", "whatsapp-auth");
const TELEGRAM_STATE_FILE = path.join(WorkDir, "channels", "telegram-state.json");

let bridge: ChannelBridge | null = null;
let whatsapp: WhatsAppTransport | null = null;
let telegram: TelegramTransport | null = null;

const status: Status = {
    whatsapp: { state: "disabled" },
    telegram: { state: "disabled" },
};

const statusListeners = new Set<(status: Status) => void>();

// Serializes apply/logout so a fast settings double-save can't interleave
// transport teardown and startup. enqueue() recovers the chain before adding
// a step — a rejected step must fail only its own caller, never poison every
// later settings save.
let lifecycle: Promise<void> = Promise.resolve();

function enqueue(step: () => Promise<void>): Promise<void> {
    const run = lifecycle.catch(() => undefined).then(step);
    lifecycle = run.catch(() => undefined);
    return run;
}

function notifyStatus(): void {
    const snapshot = structuredClone(status);
    for (const listener of statusListeners) {
        try {
            listener(snapshot);
        } catch {
            // observers must never affect the channels
        }
    }
}

function setWhatsAppStatus(next: Status["whatsapp"]): void {
    status.whatsapp = next;
    notifyStatus();
}

function setTelegramStatus(next: Status["telegram"]): void {
    status.telegram = next;
    notifyStatus();
}

export function getChannelsStatus(): Status {
    return structuredClone(status);
}

export function subscribeChannelsStatus(listener: (status: Status) => void): () => void {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
}

// Same catalog the desktop model picker uses (models:list IPC).
async function listBridgeModels(): Promise<ModelChoice[]> {
    const catalog = (await isSignedIn())
        ? await listGatewayModels()
        : await listOnboardingModels();
    return catalog.providers.flatMap((provider) =>
        provider.models.map((m) => ({
            provider: provider.id,
            model: m.id,
            label: `${m.name ?? m.id} — ${provider.name}`,
        })),
    );
}

function ensureBridge(): ChannelBridge {
    if (!bridge) {
        bridge = new ChannelBridge({
            sessions: container.resolve<ISessions>("sessions"),
            turnEventBus: container.resolve<ITurnEventBus>("turnEventBus"),
            listModels: listBridgeModels,
        });
    }
    return bridge;
}

async function stopWhatsApp(): Promise<void> {
    if (!whatsapp) return;
    const stopping = whatsapp;
    whatsapp = null;
    await stopping.stop().catch(() => undefined);
    setWhatsAppStatus({ state: "disabled" });
}

function stopTelegram(): void {
    if (!telegram) return;
    const stopping = telegram;
    telegram = null;
    stopping.stop();
    setTelegramStatus({ state: "disabled" });
}

// Invalidates pending async QR renders whenever a newer status lands.
let qrSeq = 0;

async function startWhatsApp(config: Config["whatsapp"]): Promise<void> {
    if (!config.enabled) {
        setWhatsAppStatus({ state: "disabled" });
        return;
    }
    const channelBridge = ensureBridge();
    const [{ WhatsAppTransport: Transport }, QRCode] = await Promise.all([
        import("./transports/whatsapp.js"),
        import("qrcode").then((m) => m.default),
    ]);
    const transport = new Transport({
        authDir: WHATSAPP_AUTH_DIR,
        allowFrom: config.allowFrom,
        onInbound: (senderKey, chatJid, text) => {
            // Route replies through whichever transport is current at send
            // time — the originating instance may have been replaced by a
            // settings save while the turn was running.
            const reply = async (replyText: string) => {
                const current = whatsapp;
                if (!current) throw new Error("WhatsApp channel is disabled");
                await current.send(chatJid, replyText);
            };
            void channelBridge.handleInbound(senderKey, text, reply);
        },
        onStatus: (update) => {
            if (whatsapp !== transport) return; // superseded instance
            if (update.state === "qr" && update.qr) {
                const seq = ++qrSeq;
                // Render the pairing QR main-side so the renderer just shows
                // an <img>; the raw pairing string never leaves core.
                QRCode.toDataURL(update.qr, { margin: 1, width: 256 })
                    .then((qrDataUrl) => {
                        if (whatsapp === transport && seq === qrSeq) {
                            setWhatsAppStatus({ state: "qr", qrDataUrl });
                        }
                    })
                    .catch(() => {
                        if (whatsapp === transport && seq === qrSeq) {
                            setWhatsAppStatus({ state: "error", error: "Failed to render pairing QR" });
                        }
                    });
                return;
            }
            qrSeq++;
            setWhatsAppStatus({
                state: update.state,
                ...(update.self ? { self: update.self } : {}),
                ...(update.error ? { error: update.error } : {}),
            });
        },
    });
    whatsapp = transport;
    transport.start().catch((error) => {
        if (whatsapp !== transport) return;
        setWhatsAppStatus({
            state: "error",
            error: error instanceof Error ? error.message : String(error),
        });
    });
}

function startTelegram(config: Config["telegram"]): void {
    if (!config.enabled) {
        setTelegramStatus({ state: "disabled" });
        return;
    }
    if (!config.botToken) {
        setTelegramStatus({ state: "error", error: "Bot token missing — create one with @BotFather" });
        return;
    }
    const channelBridge = ensureBridge();
    const transport = new TelegramTransport({
        botToken: config.botToken,
        allowFrom: config.allowFrom,
        stateFile: TELEGRAM_STATE_FILE,
        onInbound: (senderKey, chatId, text) => {
            const reply = async (replyText: string) => {
                const current = telegram;
                if (!current) throw new Error("Telegram channel is disabled");
                await current.send(chatId, replyText);
            };
            void channelBridge.handleInbound(senderKey, text, reply);
        },
        onStatus: (update) => {
            if (telegram !== transport) return; // superseded instance
            setTelegramStatus(update);
        },
    });
    telegram = transport;
    void transport.start();
}

export function applyChannelsConfig(config: Config): Promise<void> {
    return enqueue(async () => {
        await stopWhatsApp();
        stopTelegram();
        await startWhatsApp(config.whatsapp);
        startTelegram(config.telegram);
    });
}

// Unlink the WhatsApp device and, if the channel is still enabled, restart it
// so a fresh pairing QR appears. Telegram is left untouched.
export function logoutWhatsApp(): Promise<void> {
    return enqueue(async () => {
        if (whatsapp) {
            const out = whatsapp;
            whatsapp = null;
            await out.logout().catch(() => undefined);
        } else {
            await fs.rm(WHATSAPP_AUTH_DIR, { recursive: true, force: true }).catch(() => undefined);
        }
        const config = await container
            .resolve<IChannelsConfigRepo>("channelsConfigRepo")
            .getConfig();
        await startWhatsApp(config.whatsapp);
    });
}

export async function init(): Promise<void> {
    const config = await container
        .resolve<IChannelsConfigRepo>("channelsConfigRepo")
        .getConfig();
    await applyChannelsConfig(config);
}
