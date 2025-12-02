import { WorkDir } from "../config/config.js";
import fs from "fs/promises";
import path from "path";
import z from "zod";
import { Agent } from "./agents.js";

export interface IAgentsRepo {
    list(): Promise<z.infer<typeof Agent>[]>;
    fetch(id: string): Promise<z.infer<typeof Agent>>;
    create(agent: z.infer<typeof Agent>): Promise<void>;
    update(id: string, agent: z.infer<typeof Agent>): Promise<void>;
    delete(id: string): Promise<void>;
}

export class FSAgentsRepo implements IAgentsRepo {
    async list(): Promise<z.infer<typeof Agent>[]> {
        const result: z.infer<typeof Agent>[] = [];
        // list all json files in workdir/agents/
        const agentsDir = path.join(WorkDir, "agents");
        const files = await fs.readdir(agentsDir);

        for (const file of files) {
            const contents = await fs.readFile(path.join(agentsDir, file), "utf8");
            result.push(Agent.parse(JSON.parse(contents)));
        }
        return result;
    }

    async fetch(id: string): Promise<z.infer<typeof Agent>> {
        const contents = await fs.readFile(path.join(WorkDir, "agents", `${id}.json`), "utf8");
        return Agent.parse(JSON.parse(contents));
    }

    async create(agent: z.infer<typeof Agent>): Promise<void> {
        await fs.writeFile(path.join(WorkDir, "agents", `${agent.name}.json`), JSON.stringify(agent, null, 2));
    }
    
    async update(id: string, agent: z.infer<typeof Agent>): Promise<void> {
        await fs.writeFile(path.join(WorkDir, "agents", `${id}.json`), JSON.stringify(agent, null, 2));
    }

    async delete(id: string): Promise<void> {
        await fs.unlink(path.join(WorkDir, "agents", `${id}.json`));
    }
}