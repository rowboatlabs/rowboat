import { ResolvedSkill, SkillCatalogEntry } from "@x/shared/dist/skill.js";
import { IOfficialSkillsRepo } from "./official-repo.js";

const INCLUDE_DIRECTIVE = /\{\{include:([a-z0-9][a-z0-9_-]*)\}\}/g;

export interface ISkillResolver {
    getCatalog(): Promise<SkillCatalogEntry[]>;
    resolve(id: string): Promise<ResolvedSkill | null>;
}

export class SkillResolver implements ISkillResolver {
    private readonly officialSkillsRepo: IOfficialSkillsRepo;

    constructor({ officialSkillsRepo }: { officialSkillsRepo: IOfficialSkillsRepo }) {
        this.officialSkillsRepo = officialSkillsRepo;
    }

    async getCatalog(): Promise<SkillCatalogEntry[]> {
        const all = await this.officialSkillsRepo.listOfficial();
        return all
            .filter((s) => !s.hidden)
            .map(({ id, title, summary }) => ({ id, title, summary }));
    }

    async resolve(id: string): Promise<ResolvedSkill | null> {
        return this.resolveInner(id, new Set());
    }

    private async resolveInner(id: string, seen: Set<string>): Promise<ResolvedSkill | null> {
        if (seen.has(id)) {
            // Cycle: emit a placeholder rather than infinite-looping.
            return null;
        }
        const def = await this.officialSkillsRepo.getOfficial(id);
        if (!def) return null;
        const nextSeen = new Set(seen);
        nextSeen.add(id);
        const expanded = await this.expandIncludes(def.content, nextSeen);
        return {
            id: def.id,
            title: def.title,
            summary: def.summary,
            content: expanded,
        };
    }

    private async expandIncludes(content: string, seen: Set<string>): Promise<string> {
        const matches = Array.from(content.matchAll(INCLUDE_DIRECTIVE));
        if (matches.length === 0) return content;

        const replacements = new Map<string, string>();
        for (const match of matches) {
            const directive = match[0];
            const includeId = match[1];
            if (replacements.has(directive)) continue;
            const resolved = await this.resolveInner(includeId, seen);
            replacements.set(
                directive,
                resolved?.content ?? `<!-- missing skill include: ${includeId} -->`,
            );
        }

        return content.replace(INCLUDE_DIRECTIVE, (whole) => replacements.get(whole) ?? whole);
    }
}
