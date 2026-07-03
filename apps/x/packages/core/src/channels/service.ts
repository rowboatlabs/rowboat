import path from "node:path";
import fs from "node:fs/promises";
import QRCode from "qrcode";
import type { z } from "zod";
import type { ChannelsConfig, ChannelsStatus } from "@x/shared/dist/channels.js";
import container from "../di/container.js";
import { WorkDir } from "../config/config.js";
import type { ISessions } from "../sessions/api.js";
import type { EmitterSessionBus } from "../sessions/bus.js";
import { ChannelBridge } from "./bridge.js";
import type { IChannelsConfigRepo } from "./repo.js";
import { TelegramTransport } from "./transports/telegram.js";
import { WhatsAppTransport } from "./transports/whatsapp.js";

// Lifecycle owner for the mobile channels: reads config, runs the enabled
// transports against one shared ChannelBridge, and fans status out to the
// renderer (QR pairing, connection state). init() from main after
// sessions.initialize(); applyChannelsConfig() on every settings save.

type Config = z.infer<typeof ChannelsConfig>;
type Status = z.infer<typeof ChannelsStatus>;

const WHATSAPP_AUTH_DIR = path.join(WorkDir, "channels", "whatsapp-auth");

let bridge: ChannelBridge | null = null;
let whatsapp: WhatsAppTransport | null = null;
let telegram: TelegramTransport | null = null;

const status: Status = {
    whatsapp: { state: "disabled" },
    telegram: { state: "disabled" },
};

const statusListeners = new Set<(status: Status) => void>();

// Serializes apply/logout so a fast settings double-save can't interleave
// transport teardown and startup.
let lifecycle: Promise<void> = Promise.resolve();

function notifyStatus(): void {
    for (const listener of statusListeners) {
        try {
            listener(structuredClone(status));
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

function ensureBridge(): ChannelBridge {
    if (!bridge) {
        bridge = new ChannelBridge({
            sessions: container.resolve<ISessions>("sessions"),
            sessionBus: container.resolve<EmitterSessionBus>("sessionBus"),
        });
    }
    return bridge;
}

async function stopWhatsApp(): Promise<void> {
    if (!whatsapp) return;
    await whatsapp.stop().catch(() => undefined);
    whatsapp = null;
}

function stopTelegram(): void {
    if (!telegram) return;
    telegram.stop();
    telegram = null;
}

function startWhatsApp(config: Config["whatsapp"]): void {
    if (!config.enabled) {
        setWhatsAppStatus({ state: "disabled" });
        return;
    }
    const channelBridge = ensureBridge();
    const transport = new WhatsAppTransport({
        authDir: WHATSAPP_AUTH_DIR,
        allowFrom: config.allowFrom,
        onInbound: (senderKey, text, reply) => {
            void channelBridge.handleInbound(senderKey, text, reply);
        },
        onStatus: (update) => {
            if (update.state === "qr" && update.qr) {
                // Render the pairing QR main-side so the renderer just shows
                // an <img>; the raw pairing string never leaves core.
                QRCode.toDataURL(update.qr, { margin: 1, width: 256 })
                    .then((qrDataUrl) => setWhatsAppStatus({ state: "qr", qrDataUrl }))
                    .catch(() => setWhatsAppStatus({ state: "error", error: "Failed to render pairing QR" }));
                return;
            }
            setWhatsAppStatus({
                state: update.state,
                ...(update.self ? { self: update.self } : {}),
                ...(update.error ? { error: update.error } : {}),
            });
        },
    });
    whatsapp = transport;
    transport.start().catch((error) => {
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
        onInbound: (senderKey, text, reply) => {
            void channelBridge.handleInbound(senderKey, text, reply);
        },
        onStatus: setTelegramStatus,
    });
    telegram = transport;
    void transport.start();
}

export function applyChannelsConfig(config: Config): Promise<void> {
    lifecycle = lifecycle.then(async () => {
        await stopWhatsApp();
        stopTelegram();
        startWhatsApp(config.whatsapp);
        startTelegram(config.telegram);
    });
    return lifecycle;
}

// Unlink the WhatsApp device and, if the channel is still enabled, restart it
// so a fresh pairing QR appears. Telegram is left untouched.
export function logoutWhatsApp(): Promise<void> {
    lifecycle = lifecycle.then(async () => {
        if (whatsapp) {
            await whatsapp.logout().catch(() => undefined);
            whatsapp = null;
        } else {
            await fs.rm(WHATSAPP_AUTH_DIR, { recursive: true, force: true });
        }
        const config = await container
            .resolve<IChannelsConfigRepo>("channelsConfigRepo")
            .getConfig();
        startWhatsApp(config.whatsapp);
    });
    return lifecycle;
}

export async function init(): Promise<void> {
    const config = await container
        .resolve<IChannelsConfigRepo>("channelsConfigRepo")
        .getConfig();
    await applyChannelsConfig(config);
}
