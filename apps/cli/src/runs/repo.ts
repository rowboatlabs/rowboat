import { Run } from "./runs.js";
import z from "zod";
import { IMonotonicallyIncreasingIdGenerator } from "../application/lib/id-gen.js";
import { WorkDir } from "../config/config.js";
import path from "path";
import fsp from "fs/promises";
import { RunEvent, StartEvent } from "../entities/run-events.js";

export const ListRunsResponse = z.object({
    runs: z.array(Run.pick({
        id: true,
        createdAt: true,
        agentId: true,
    })),
    nextCursor: z.string().optional(),
});

export const CreateRunOptions = Run.pick({
    agentId: true,
});

export interface IRunsRepo {
    create(options: z.infer<typeof CreateRunOptions>): Promise<z.infer<typeof Run>>;
    fetch(id: string): Promise<z.infer<typeof Run>>;
    list(cursor?: string): Promise<z.infer<typeof ListRunsResponse>>;
    appendEvents(runId: string, events: z.infer<typeof RunEvent>[]): Promise<void>;
}

export class FSRunsRepo implements IRunsRepo {
    private idGenerator: IMonotonicallyIncreasingIdGenerator;
    constructor({
        idGenerator,
    }: {
        idGenerator: IMonotonicallyIncreasingIdGenerator;
    }) {
        this.idGenerator = idGenerator;
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
        return {
            id,
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
        } catch (err: any) {
            if (err && err.code === 'ENOENT') {
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
            try {
                const contents = await fsp.readFile(path.join(runsDir, name), 'utf8');
                const firstLine = contents.split('\n').find(line => line.trim() !== '');
                if (!firstLine) {
                    continue;
                }
                const start = StartEvent.parse(JSON.parse(firstLine));
                runs.push({
                    id: runId,
                    createdAt: start.ts!,
                    agentId: start.agentName,
                });
            } catch {
                continue;
            }
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
}