import { WorkDir } from "../config/config.js";
import fs from "fs/promises";
import { glob } from "node:fs/promises";
import path from "path";
import z from "zod";
import { Agent } from "@x/shared/dist/agent.js";
import { parse, stringify } from "yaml";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const UpdateAgentSchema = Agent.omit({ name: true });

export interface IAgentsRepo {
    list(): Promise<z.infer<typeof Agent>[]>;
    fetch(id: string): Promise<z.infer<typeof Agent>>;
    create(agent: z.infer<typeof Agent>): Promise<void>;
    update(id: string, agent: z.infer<typeof Agent>): Promise<void>;
    delete(id: string): Promise<void>;
}

export class FSAgentsRepo implements IAgentsRepo {
    private readonly agentsDir = path.join(WorkDir, "agents");

    async list(): Promise<z.infer<typeof Agent>[]> {
        const result: z.infer<typeof Agent>[] = [];

        // list all md files in workdir/agents/
        // const matches = await Array.fromAsync(glob("**/*.md", { cwd: this.agentsDir }));
        const matches: string[] = [];
        const results = glob("**/*.md", { cwd: this.agentsDir });
        for await (const file of results) {
            matches.push(file);
        }
        for (const file of matches) {
            try {
                const agent = await this.parseAgentMd(path.join(this.agentsDir, file));
                result.push(agent);
            } catch (error) {
                console.error(`Error parsing agent ${file}: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
        }
        return result;
    }

    private async parseAgentMd(filePath: string): Promise<z.infer<typeof Agent>> {
        const raw = await fs.readFile(filePath, "utf8");

        // strip the path prefix from the file name
        // and the .md extension
        const agentName = filePath
            .replace(this.agentsDir + "/", "")
            .replace(/\.md$/, "");
        let agent: z.infer<typeof Agent> = {
            name: agentName,
            instructions: raw,
        };
        let content = raw;

        // check for frontmatter markers at start
        if (raw.startsWith("---")) {
            const end = raw.indexOf("\n---", 3);

            if (end !== -1) {
                const fm = raw.slice(3, end).trim();       // YAML text
                content = raw.slice(end + 4).trim();       // body after frontmatter
                const yaml = parse(fm);
                const parsed = Agent
                    .omit({ name: true, instructions: true })
                    .parse(yaml);
                agent = {
                    ...agent,
                    ...parsed,
                    instructions: content,
                };
            }
        }

        return agent;
    }

    async fetch(id: string): Promise<z.infer<typeof Agent>> {
        return this.parseAgentMd(path.join(this.agentsDir, `${id}.md`));
    }

    async create(agent: z.infer<typeof Agent>): Promise<void> {
        const { instructions, ...rest } = agent;
        const contents = `---\n${stringify(rest)}\n---\n${instructions}`;
        await fs.writeFile(path.join(this.agentsDir, `${agent.name}.md`), contents);
    }

    async update(id: string, agent: z.infer<typeof UpdateAgentSchema>): Promise<void> {
        const { instructions, ...rest } = agent;
        const contents = `---\n${stringify(rest)}\n---\n${instructions}`;
        await fs.writeFile(path.join(this.agentsDir, `${id}.md`), contents);
    }

    async delete(id: string): Promise<void> {
        await fs.unlink(path.join(this.agentsDir, `${id}.md`));
    }
}