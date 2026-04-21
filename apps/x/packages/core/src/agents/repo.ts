import { WorkDir } from "../config/config.js";
import fs from "fs/promises";
import { glob } from "node:fs/promises";
import path from "path";
import z from "zod";
import { Agent } from "@x/shared/dist/agent.js";
import { stringify } from "yaml";
import { parseFrontmatter } from "../application/lib/parse-frontmatter.js";

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
                result.push({
                    ...agent,
                    name: file.replace(/\.md$/, ""),
                });
            } catch (error) {
                console.error(`Error parsing agent ${file}: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
        }
        return result;
    }

    private async parseAgentMd(filepath: string): Promise<z.infer<typeof Agent>> {
        const raw = await fs.readFile(filepath, "utf8");

        const { frontmatter, content } = parseFrontmatter(raw);
        if (frontmatter) {
            const parsed = Agent
                .omit({ instructions: true })
                .parse(frontmatter);

            return {
                ...parsed,
                instructions: content,
            };
        }

        return {
            name: filepath,
            instructions: raw,
        };
    }

    async fetch(id: string): Promise<z.infer<typeof Agent>> {
        const agent = await this.parseAgentMd(path.join(this.agentsDir, `${id}.md`));
        return {
            ...agent,
            name: id,
        };
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