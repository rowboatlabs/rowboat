import { Agent } from "../agents/agents.js";
import { IAgentsRepo } from "../agents/repo.js";
import { WorkDir } from "../config/config.js";
import container from "../di/container.js";
import { glob, readFile } from "node:fs/promises";
import path from "path";

const main = async () => {
    const agentsRepo = container.resolve<IAgentsRepo>("agentsRepo");
    const matches = await Array.fromAsync(glob("**/*.json", { cwd: path.join(WorkDir, "agents") }));
    for (const file of matches) {
        try {
            const agent = Agent.parse(JSON.parse(await readFile(path.join(WorkDir, "agents", file), "utf8")));
            await agentsRepo.create(agent);
            console.error(`migrated agent ${file}`);
        } catch (error) {
            console.error(`Error parsing agent ${file}: ${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
    }
}

main();