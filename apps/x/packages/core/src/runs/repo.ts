import z from "zod";
import { IMonotonicallyIncreasingIdGenerator } from "../application/lib/id-gen.js";
import { WorkDir } from "../config/config.js";
import path from "path";
import fsp from "fs/promises";
import fs from "fs";
import readline from "readline";
import { Run, RunEvent, StartEvent, CreateRunOptions, ListRunsResponse, MessageEvent } from "@x/shared/dist/runs.js";
import { getDefaultModelAndProvider } from "../models/defaults.js";

/**
 * Reading-only schemas: extend the canonical `StartEvent` / `RunEvent` to
 * accept legacy run files written before `model`/`provider` were required.
 *
 * `RunEvent.or(LegacyStartEvent)` works because zod unions try left-to-right:
 * for any non-start event RunEvent matches first; for a strict start event
 * RunEvent still matches; only a legacy start event falls through and parses
 * as LegacyStartEvent. New event types stay maintained in one place
 * (`@x/shared/dist/runs.js`) — the lenient form just adds one fallback variant.
 */
const LegacyStartEvent = StartEvent.extend({
    model: z.string().optional(),
    provider: z.string().optional(),
});
const ReadRunEvent = RunEvent.or(LegacyStartEvent);

export type CreateRunRepoOptions = Required<z.infer<typeof CreateRunOptions>>;

export interface IRunsRepo {
    create(options: CreateRunRepoOptions): Promise<z.infer<typeof Run>>;
    fetch(id: string): Promise<z.infer<typeof Run>>;
    list(cursor?: string): Promise<z.infer<typeof ListRunsResponse>>;
    appendEvents(runId: string, events: z.infer<typeof RunEvent>[]): Promise<void>;
    delete(id: string): Promise<void>;
}

/**
 * Strip attached-files XML from message content for title display (keeps @mentions)
 */
function cleanContentForTitle(content: string): string {
    // Remove the entire attached-files block
    let cleaned = content.replace(/<attached-files>\s*[\s\S]*?\s*<\/attached-files>/g, '');

    // Clean up extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
}

export class FSRunsRepo implements IRunsRepo {
    private idGenerator: IMonotonicallyIncreasingIdGenerator;
    constructor({
        idGenerator,
    }: {
        idGenerator: IMonotonicallyIncreasingIdGenerator;
    }) {
        this.idGenerator = idGenerator;
        // ensure runs directory exists
        fsp.mkdir(path.join(WorkDir, 'runs'), { recursive: true });
    }

    private extractTitle(events: z.infer<typeof RunEvent>[]): string | undefined {
        for (const event of events) {
            if (event.type === 'message') {
                const messageEvent = event as z.infer<typeof MessageEvent>;
                if (messageEvent.message.role === 'user') {
                    const content = messageEvent.message.content;
                    let textContent: string | undefined;
                    if (typeof content === 'string') {
                        textContent = content;
                    } else {
                        textContent = content
                            .filter(p => p.type === 'text')
                            .map(p => p.text)
                            .join('');
                    }
                    if (textContent && textContent.trim()) {
                        const cleaned = cleanContentForTitle(textContent);
                        if (!cleaned) continue;
                        return cleaned.length > 100 ? cleaned.substring(0, 100) : cleaned;
                    }
                }
            }
        }
        return undefined;
    }

    /**
     * Read file line-by-line using streams, stopping early once we have
     * the start event and title (or determine there's no title).
     *
     * Parses the start event with `LegacyStartEvent` so runs written before
     * `model`/`provider` were required still surface in the list view.
     */
    private async readRunMetadata(filePath: string): Promise<{
        start: z.infer<typeof LegacyStartEvent>;
        title: string | undefined;
    } | null> {
        return new Promise((resolve) => {
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

            let start: z.infer<typeof LegacyStartEvent> | null = null;
            let title: string | undefined;
            let lineIndex = 0;

            rl.on('line', (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;

                try {
                    if (lineIndex === 0) {
                        start = LegacyStartEvent.parse(JSON.parse(trimmed));
                    } else {
                        // Subsequent lines - look for first user message or assistant response
                        const event = ReadRunEvent.parse(JSON.parse(trimmed));
                        if (event.type === 'message') {
                            const msg = event.message;
                            if (msg.role === 'user') {
                                // Found first user message - use as title
                                const content = msg.content;
                                let textContent: string | undefined;
                                if (typeof content === 'string') {
                                    textContent = content;
                                } else {
                                    textContent = content
                                        .filter(p => p.type === 'text')
                                        .map(p => p.text)
                                        .join('');
                                }
                                if (textContent && textContent.trim()) {
                                    const cleaned = cleanContentForTitle(textContent);
                                    if (cleaned) {
                                        title = cleaned.length > 100 ? cleaned.substring(0, 100) : cleaned;
                                    }
                                }
                                // Stop reading
                                rl.close();
                                stream.destroy();
                                return;
                            } else if (msg.role === 'assistant') {
                                // Assistant responded before any user message - no title
                                rl.close();
                                stream.destroy();
                                return;
                            }
                        }
                    }
                    lineIndex++;
                } catch {
                    // Skip malformed lines
                }
            });

            rl.on('close', () => {
                if (start) {
                    resolve({ start, title });
                } else {
                    resolve(null);
                }
            });

            rl.on('error', () => {
                resolve(null);
            });

            stream.on('error', () => {
                rl.close();
                resolve(null);
            });
        });
    }

    async appendEvents(runId: string, events: z.infer<typeof RunEvent>[]): Promise<void> {
        await fsp.appendFile(
            path.join(WorkDir, 'runs', `${runId}.jsonl`),
            events.map(event => JSON.stringify(event)).join("\n") + "\n"
        );
    }

    async create(options: CreateRunRepoOptions): Promise<z.infer<typeof Run>> {
        const runId = await this.idGenerator.next();
        const ts = new Date().toISOString();
        const start: z.infer<typeof StartEvent> = {
            type: "start",
            runId,
            agentName: options.agentId,
            model: options.model,
            provider: options.provider,
            subflow: [],
            ts,
        };
        await this.appendEvents(runId, [start]);
        return {
            id: runId,
            createdAt: ts,
            agentId: options.agentId,
            model: options.model,
            provider: options.provider,
            log: [start],
        };
    }

    async fetch(id: string): Promise<z.infer<typeof Run>> {
        const contents = await fsp.readFile(path.join(WorkDir, 'runs', `${id}.jsonl`), 'utf8');
        // Parse with the lenient schema so legacy start events (no model/provider) load.
        const rawEvents = contents.split('\n')
            .filter(line => line.trim() !== '')
            .map(line => ReadRunEvent.parse(JSON.parse(line)));
        if (rawEvents.length === 0 || rawEvents[0].type !== 'start') {
            throw new Error('Corrupt run data');
        }
        // Backfill model/provider on the start event from current defaults if missing,
        // then promote to the canonical strict types for callers.
        const rawStart = rawEvents[0];
        const defaults = (!rawStart.model || !rawStart.provider)
            ? await getDefaultModelAndProvider()
            : null;
        const start: z.infer<typeof StartEvent> = {
            ...rawStart,
            model: rawStart.model ?? defaults!.model,
            provider: rawStart.provider ?? defaults!.provider,
        };
        const events: z.infer<typeof RunEvent>[] = [start, ...rawEvents.slice(1) as z.infer<typeof RunEvent>[]];
        const title = this.extractTitle(events);
        return {
            id,
            title,
            createdAt: start.ts!,
            agentId: start.agentName,
            model: start.model,
            provider: start.provider,
            log: events,
        };
    }

    async list(cursor?: string): Promise<z.infer<typeof ListRunsResponse>> {
        const runsDir = path.join(WorkDir, 'runs');
        const PAGE_SIZE = 20;

        let files: string[] = [];
        try {
            const entries = await fsp.readdir(runsDir, { withFileTypes: true });
            files = entries
                .filter(e => e.isFile() && e.name.endsWith('.jsonl'))
                .map(e => e.name);
        } catch (err: unknown) {
            const e = err as { code?: string };
            if (e.code === 'ENOENT') {
                return { runs: [] };
            }
            throw err;
        }

        files.sort((a, b) => b.localeCompare(a));

        const cursorFile = cursor;
        let startIndex = 0;
        if (cursorFile) {
            const exact = files.indexOf(cursorFile);
            if (exact >= 0) {
                startIndex = exact + 1;
            } else {
                const firstOlder = files.findIndex(name => name.localeCompare(cursorFile) < 0);
                startIndex = firstOlder === -1 ? files.length : firstOlder;
            }
        }

        const selected = files.slice(startIndex, startIndex + PAGE_SIZE);
        const runs: z.infer<typeof ListRunsResponse>['runs'] = [];

        for (const name of selected) {
            const runId = name.slice(0, -'.jsonl'.length);
            const metadata = await this.readRunMetadata(path.join(runsDir, name));
            if (!metadata) {
                continue;
            }
            runs.push({
                id: runId,
                title: metadata.title,
                createdAt: metadata.start.ts!,
                agentId: metadata.start.agentName,
            });
        }

        const hasMore = startIndex + PAGE_SIZE < files.length;
        const nextCursor = hasMore && selected.length > 0
            ? selected[selected.length - 1]
            : undefined;

        return {
            runs,
            ...(nextCursor ? { nextCursor } : {}),
        };
    }

    async delete(id: string): Promise<void> {
        const filePath = path.join(WorkDir, 'runs', `${id}.jsonl`);
        await fsp.unlink(filePath);
    }
}