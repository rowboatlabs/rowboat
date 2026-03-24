import fs from "node:fs/promises";
import path from "node:path";
import { WorkDir } from "../config/config.js";
import { parseSkillMd } from "./skill-md-parser.js";
import type { SkillDefinition } from "./types.js";

export interface IOfficialSkillsRepo {
    listOfficial(): Promise<SkillDefinition[]>;
    getOfficial(id: string): Promise<SkillDefinition | null>;
}

export class FSOfficialSkillsRepo implements IOfficialSkillsRepo {
    private readonly officialDir = path.join(WorkDir, "skills", "official");

    async listOfficial(): Promise<SkillDefinition[]> {
        const result: SkillDefinition[] = [];
        let entries: string[];
        try {
            entries = await fs.readdir(this.officialDir);
        } catch {
            return result;
        }

        for (const entry of entries) {
            const skillMdPath = path.join(this.officialDir, entry, "SKILL.md");
            try {
                const raw = await fs.readFile(skillMdPath, "utf-8");
                result.push(parseSkillMd(raw, entry));
            } catch {
                // Not a valid skill directory, skip
            }
        }

        return result;
    }

    async getOfficial(id: string): Promise<SkillDefinition | null> {
        const skillMdPath = path.join(this.officialDir, id, "SKILL.md");
        try {
            const raw = await fs.readFile(skillMdPath, "utf-8");
            return parseSkillMd(raw, id);
        } catch {
            return null;
        }
    }
}
