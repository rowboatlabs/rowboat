import fs from "node:fs/promises";
import makeWASocket, {
    DisconnectReason,
    areJidsSameUser,
    isJidGroup,
    jidDecode,
    useMultiFileAuthState,
} from "baileys";

// WhatsApp transport via Baileys: the app links to the user's own WhatsApp
// account as a linked device (QR pairing, same as WhatsApp Web) over an
// outbound WebSocket — no server, no port forwarding.
//
// Access model: the linked account's own self-chat ("message yourself") is
// always allowed; other senders must be explicitly allowlisted by phone
// number. Group chats are ignored entirely.

type WASocket = ReturnType<typeof makeWASocket>;

const RECONNECT_DELAY_MS = 3000;
// Marks bridge-sent messages. In the self-chat our own replies come back on
// messages.upsert like any other message; the marker (plus sent-id tracking)
// keeps the bridge from answering itself in a loop.
const REPLY_MARKER = "🤖 ";

export interface WhatsAppTransportStatus {
    state: "starting" | "qr" | "connected" | "error" | "disabled";
    qr?: string;
    self?: string;
    error?: string;
}

export interface WhatsAppTransportOptions {
    authDir: string;
    allowFrom: string[];
    // chatJid is the address to reply to; the caller owns reply routing so a
    // reply can go through whichever transport instance is current by then.
    onInbound: (senderKey: string, chatJid: string, text: string) => void;
    onStatus: (status: WhatsAppTransportStatus) => void;
}

interface TextishMessage {
    conversation?: unknown;
    extendedTextMessage?: { text?: unknown };
    ephemeralMessage?: { message?: TextishMessage };
}

interface InboundWAMessage {
    key?: {
        remoteJid?: string | null;
        // Phone-number JID when remoteJid is a LID (anonymized) JID.
        remoteJidAlt?: string | null;
        fromMe?: boolean | null;
        id?: string | null;
    };
    message?: unknown;
}

function messageText(message: unknown): string | null {
    if (!message || typeof message !== "object") return null;
    const m = message as TextishMessage;
    const unwrapped = m.ephemeralMessage?.message ?? m;
    const text: unknown = unwrapped.conversation ?? unwrapped.extendedTextMessage?.text;
    return typeof text === "string" && text ? text : null;
}

export class WhatsAppTransport {
    private sock: WASocket | null = null;
    private stopped = false;
    // Bumped on every connect/stop/logout; handlers close over their own
    // generation and go inert the moment they are superseded, so a stop()
    // racing an await inside connect() cannot leave a zombie socket
    // processing messages alongside its replacement.
    private generation = 0;
    private sentIds = new Set<string>();

    constructor(private readonly opts: WhatsAppTransportOptions) {}

    async start(): Promise<void> {
        this.stopped = false;
        this.opts.onStatus({ state: "starting" });
        await this.connect();
    }

    async stop(): Promise<void> {
        this.stopped = true;
        this.generation++;
        try {
            this.sock?.end(undefined);
        } catch {
            // already closed
        }
        this.sock = null;
        this.opts.onStatus({ state: "disabled" });
    }

    // Unlink this device: invalidates the pairing on the phone and clears
    // local credentials so the next start shows a fresh QR.
    async logout(): Promise<void> {
        this.stopped = true;
        this.generation++;
        try {
            await this.sock?.logout();
        } catch {
            // best effort — clearing creds below is what actually unpairs us
        }
        this.sock = null;
        await fs.rm(this.opts.authDir, { recursive: true, force: true });
        this.opts.onStatus({ state: "disabled" });
    }

    private async connect(): Promise<void> {
        if (this.stopped) return;
        const generation = ++this.generation;
        const { state, saveCreds } = await useMultiFileAuthState(this.opts.authDir);
        if (this.stopped || generation !== this.generation) return;
        const sock = makeWASocket({
            auth: state,
            syncFullHistory: false,
            markOnlineOnConnect: false,
        });
        this.sock = sock;
        const isCurrent = () =>
            !this.stopped && generation === this.generation && this.sock === sock;

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", (update) => {
            if (!isCurrent()) return;
            if (update.qr) {
                this.opts.onStatus({ state: "qr", qr: update.qr });
            }
            if (update.connection === "open") {
                const self = jidDecode(sock.user?.id ?? "")?.user;
                this.opts.onStatus({ state: "connected", ...(self ? { self } : {}) });
            }
            if (update.connection === "close") {
                const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
                    ?.output?.statusCode;
                if (statusCode === DisconnectReason.loggedOut) {
                    // Unlinked from the phone; stale creds would loop forever.
                    void fs.rm(this.opts.authDir, { recursive: true, force: true });
                    this.opts.onStatus({
                        state: "error",
                        error: "Logged out from the phone — toggle WhatsApp off and on to pair again.",
                    });
                    return;
                }
                setTimeout(() => {
                    if (!isCurrent()) return;
                    this.connect().catch((error) => {
                        this.opts.onStatus({
                            state: "error",
                            error: error instanceof Error ? error.message : String(error),
                        });
                    });
                }, RECONNECT_DELAY_MS);
            }
        });

        sock.ev.on("messages.upsert", ({ messages, type }) => {
            if (!isCurrent() || type !== "notify") return;
            for (const msg of messages) {
                this.handleMessage(sock, msg);
            }
        });
    }

    private handleMessage(sock: WASocket, msg: InboundWAMessage): void {
        const jid: string | undefined = msg.key?.remoteJid ?? undefined;
        if (!jid || isJidGroup(jid) || jid === "status@broadcast") return;
        const messageId: string | undefined = msg.key?.id ?? undefined;
        if (messageId && this.sentIds.has(messageId)) return;
        const text = messageText(msg.message);
        if (!text || text.startsWith(REPLY_MARKER)) return;

        // LID-addressed chats put the anonymized id in remoteJid and (when
        // the server supplies it) the real phone-number JID in remoteJidAlt.
        // Identity checks must consider both.
        const altJid: string | undefined = msg.key?.remoteJidAlt ?? undefined;
        const chatJids = altJid ? [jid, altJid] : [jid];
        const user = sock.user as { id?: string; lid?: string } | undefined;
        const selfIds = [user?.id, user?.lid].filter((v): v is string => Boolean(v));
        const isSelfChat = chatJids.some((j) =>
            selfIds.some((selfId) => areJidsSameUser(j, selfId)),
        );
        const senderNumbers = chatJids.flatMap((j) => {
            const decoded = jidDecode(j)?.user;
            return decoded ? [decoded] : [];
        });

        // Self-chat is the owner by definition. Anyone else must be
        // allowlisted — this bridge is remote control over the desktop agent.
        if (!isSelfChat) {
            if (msg.key?.fromMe) return;
            if (!senderNumbers.some((n) => this.opts.allowFrom.includes(n))) return;
        }

        // Prefer the phone number (altJid decodes to it when present) as the
        // stable sender identity.
        const senderId = altJid
            ? (jidDecode(altJid)?.user ?? senderNumbers[0] ?? jid)
            : (senderNumbers[0] ?? jid);
        this.opts.onInbound(`whatsapp:${senderId}`, jid, text);
    }

    async send(jid: string, text: string): Promise<void> {
        const sock = this.sock;
        if (!sock) throw new Error("WhatsApp is not connected");
        const sent = await sock.sendMessage(jid, { text: `${REPLY_MARKER}${text}` });
        const id = sent?.key?.id;
        if (id) {
            this.sentIds.add(id);
            if (this.sentIds.size > 500) {
                this.sentIds = new Set(Array.from(this.sentIds).slice(-250));
            }
        }
    }
}
