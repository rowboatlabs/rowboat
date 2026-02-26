import z from "zod";
import { IMonotonicallyIncreasingIdGenerator } from "../application/lib/id-gen.js";
import { WorkDir } from "../config/config.js";
import path from "path";
import fsp from "fs/promises";
import fs from "fs";
import readline from "readline";
import { Run, RunEvent, StartEvent, CreateRunOptions, ListRunsResponse, MessageEvent } from "@x/shared/dist/runs.js";

export interface IRunsRepo {
    create(options: z.infer<typeof CreateRunOptions>): Promise<z.infer<typeof Run>>;
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
     */
    private async readRunMetadata(filePath: string): Promise<{
        start: z.infer<typeof StartEvent>;
        title: string | undefined;
    } | null> {
        return new Promise((resolve) => {
            const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

            let start: z.infer<typeof StartEvent> | null = null;
            let title: string | undefined;
            let lineIndex = 0;

            rl.on('line', (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;

                try {
                    if (lineIndex === 0) {
                        // First line should be the start event
                        start = StartEvent.parse(JSON.parse(trimmed));
                    } else {
                        // Subsequent lines - look for first user message or assistant response
                        const event = RunEvent.parse(JSON.parse(trimmed));
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

    async create(options: z.infer<typeof CreateRunOptions>): Promise<z.infer<typeof Run>> {
        const runId = await this.idGenerator.next();
        const ts = new Date().toISOString();
        const start: z.infer<typeof StartEvent> = {
            type: "start",
            runId,
            agentName: options.agentId,
            subflow: [],
            ts,
        };
        await this.appendEvents(runId, [start]);
        return {
            id: runId,
            createdAt: ts,
            agentId: options.agentId,
            log: [start],
        };
    }

    async fetch(id: string): Promise<z.infer<typeof Run>> {
        const contents = await fsp.readFile(path.join(WorkDir, 'runs', `${id}.jsonl`), 'utf8');
        const events = contents.split('\n')
            .filter(line => line.trim() !== '')
            .map(line => RunEvent.parse(JSON.parse(line)));
        if (events.length === 0 || events[0].type !== 'start') {
            throw new Error('Corrupt run data');
        }
        const title = this.extractTitle(events);
        return {
            id,
            title,
            createdAt: events[0].ts!,
            agentId: events[0].agentName,
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