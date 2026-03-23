import { ResolvedSkill } from "@x/shared/dist/skill.js";
import { officialDefinitions, type SkillDefinition } from "../application/assistant/skills/index.js";
import { ISkillsRepo } from "./repo.js";

export interface ISkillResolver {
    getCatalog(): Promise<ResolvedSkill[]>;
    resolve(id: string): Promise<ResolvedSkill | null>;
    getOfficial(id: string): ResolvedSkill | null;
    generateCatalogMarkdown(): Promise<string>;
}

export class SkillResolver implements ISkillResolver {
    private readonly officialMap: Map<string, SkillDefinition>;
    private readonly skillsRepo: ISkillsRepo;

    constructor({ skillsRepo }: { skillsRepo: ISkillsRepo }) {
        this.skillsRepo = skillsRepo;
        this.officialMap = new Map(
            officialDefinitions.map((d) => [d.id, d]),
        );
    }

    async getCatalog(): Promise<ResolvedSkill[]> {
        const overrides = await this.skillsRepo.listOverrides();
        const overrideMap = new Map(overrides.map((o) => [o.skillId, o]));

        const results: ResolvedSkill[] = [];

        for (const official of officialDefinitions) {
            const override = overrideMap.get(official.id);
            if (override) {
                results.push({
                    id: official.id,
                    title: override.meta.title ?? official.title,
                    summary: override.meta.summary ?? official.summary,
                    version: official.version,
                    source: "override",
                    content: override.content,
                    hasUpdate: override.meta.base_version !== official.version,
                    baseVersion: override.meta.base_version,
                });
            } else {
                results.push({
                    id: official.id,
                    title: official.title,
                    summary: official.summary,
                    version: official.version,
                    source: "official",
                    content: official.content,
                });
            }
        }

        return results;
    }

    async resolve(id: string): Promise<ResolvedSkill | null> {
        const official = this.officialMap.get(id);
        if (!official) return null;

        const override = await this.skillsRepo.getOverride(id);
        if (override) {
            return {
                id: official.id,
                title: override.meta.title ?? official.title,
                summary: override.meta.summary ?? official.summary,
                version: official.version,
                source: "override",
                content: override.content,
                hasUpdate: override.meta.base_version !== official.version,
                baseVersion: override.meta.base_version,
            };
        }

        return {
            id: official.id,
            title: official.title,
            summary: official.summary,
            version: official.version,
            source: "official",
            content: official.content,
        };
    }

    getOfficial(id: string): ResolvedSkill | null {
        const official = this.officialMap.get(id);
        if (!official) return null;

        return {
            id: official.id,
            title: official.title,
            summary: official.summary,
            version: official.version,
            source: "official",
            content: official.content,
        };
    }

    async generateCatalogMarkdown(): Promise<string> {
        const catalog = await this.getCatalog();
        const sections = catalog.map((skill) => [
            `## ${skill.title}`,
            `- **Skill file:** \`${skill.id}\``,
            `- **Use it for:** ${skill.summary}`,
        ].join("\n"));

        return [
            "# Rowboat Skill Catalog",
            "",
            "Use this catalog to see which specialized skills you can load. Each entry lists the skill id plus a short description of when it helps.",
            "",
            sections.join("\n\n"),
        ].join("\n");
    }
}
