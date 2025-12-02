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
}