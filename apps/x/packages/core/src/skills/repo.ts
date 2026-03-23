import { WorkDir } from "../config/config.js";
import fs from "fs/promises";
import path from "path";
import { parse, stringify } from "yaml";
import { SkillOverride, SkillOverrideEntry } from "@x/shared/dist/skill.js";

export interface ISkillsRepo {
    listOverrides(): Promise<SkillOverrideEntry[]>;
    getOverride(skillId: string): Promise<SkillOverrideEntry | null>;
    saveOverride(skillId: string, meta: SkillOverride, content: string): Promise<void>;
    deleteOverride(skillId: string): Promise<void>;
}

export class FSSkillsRepo implements ISkillsRepo {
    private readonly overridesDir = path.join(WorkDir, "skills", "overrides");

    async listOverrides(): Promise<SkillOverrideEntry[]> {
        const result: SkillOverrideEntry[] = [];
        let files: string[];
        try {
            files = await fs.readdir(this.overridesDir);
        } catch {
            return result;
        }

        for (const file of files) {
            if (!file.endsWith(".md")) continue;
            try {
                const entry = await this.parseOverrideMd(path.join(this.overridesDir, file));
                result.push(entry);
            } catch (error) {
                console.error(`Error parsing skill override ${file}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return result;
    }

    async getOverride(skillId: string): Promise<SkillOverrideEntry | null> {
        const filePath = path.join(this.overridesDir, `${skillId}.md`);
        try {
            await fs.access(filePath);
            return await this.parseOverrideMd(filePath);
        } catch {
            return null;
        }
    }

    async saveOverride(skillId: string, meta: SkillOverride, content: string): Promise<void> {
        await fs.mkdir(this.overridesDir, { recursive: true });
        const frontmatter = stringify(meta);
        const fileContent = `---\n${frontmatter}---\n${content}`;
        await fs.writeFile(path.join(this.overridesDir, `${skillId}.md`), fileContent);
    }

    async deleteOverride(skillId: string): Promise<void> {
        const filePath = path.join(this.overridesDir, `${skillId}.md`);
        try {
            await fs.unlink(filePath);
        } catch {
            // File doesn't exist, nothing to delete
        }
    }

    private async parseOverrideMd(filePath: string): Promise<SkillOverrideEntry> {
        const raw = await fs.readFile(filePath, "utf8");
        const skillId = path.basename(filePath, ".md");

        if (!raw.startsWith("---")) {
            throw new Error(`Skill override ${skillId} missing frontmatter`);
        }

        const end = raw.indexOf("\n---", 3);
        if (end === -1) {
            throw new Error(`Skill override ${skillId} has malformed frontmatter`);
        }

        const fm = raw.slice(3, end).trim();
        const body = raw.slice(end + 4).trim();
        const meta = SkillOverride.parse(parse(fm));

        return {
            skillId,
            meta,
            content: body,
        };
    }
}
