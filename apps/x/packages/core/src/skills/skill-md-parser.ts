import { parse } from "yaml";
import { SkillFrontmatter } from "@x/shared/dist/skill.js";
import type { SkillDefinition } from "./types.js";

/**
 * Parse a SKILL.md file (YAML frontmatter + markdown body) into a SkillDefinition.
 * Follows the Agent Skills spec: frontmatter between --- markers.
 */
export function parseSkillMd(raw: string, fallbackId?: string): SkillDefinition {
    if (!raw.startsWith("---")) {
        throw new Error("SKILL.md missing frontmatter (must start with ---)");
    }

    const end = raw.indexOf("\n---", 3);
    if (end === -1) {
        throw new Error("SKILL.md has malformed frontmatter (missing closing ---)");
    }

    const fm = raw.slice(3, end).trim();
    const body = raw.slice(end + 4).trim();
    const parsed = SkillFrontmatter.parse(parse(fm));

    return {
        id: parsed.name ?? fallbackId ?? "unknown",
        title: parsed.metadata?.title ?? parsed.name,
        summary: parsed.description,
        version: parsed.metadata?.version ?? "0.0.0",
        content: body,
    };
}
