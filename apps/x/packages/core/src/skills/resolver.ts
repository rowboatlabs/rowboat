import { ResolvedSkill } from "@x/shared/dist/skill.js";
import { IOfficialSkillsRepo } from "./official-repo.js";
import { substitutePlaceholders } from "./placeholders.js";

export interface ISkillResolver {
    getCatalog(): Promise<ResolvedSkill[]>;
    resolve(id: string): Promise<ResolvedSkill | null>;
}

export class SkillResolver implements ISkillResolver {
    private readonly officialSkillsRepo: IOfficialSkillsRepo;

    constructor({ officialSkillsRepo }: { officialSkillsRepo: IOfficialSkillsRepo }) {
        this.officialSkillsRepo = officialSkillsRepo;
    }

    async getCatalog(): Promise<ResolvedSkill[]> {
        const officials = await this.officialSkillsRepo.listOfficial();
        return officials.map((official) => ({
            id: official.id,
            title: official.title,
            summary: official.summary,
            content: substitutePlaceholders(official.content),
        }));
    }

    async resolve(id: string): Promise<ResolvedSkill | null> {
        const official = await this.officialSkillsRepo.getOfficial(id);
        if (!official) return null;
        return {
            id: official.id,
            title: official.title,
            summary: official.summary,
            content: substitutePlaceholders(official.content),
        };
    }
}
