import { parse } from "yaml";
import { SkillFrontmatter } from "@x/shared/dist/skill.js";
import type { SkillDefinition } from "./types.js";

/**
 * Parse a SKILL.md file (YAML frontmatter + markdown body) into a SkillDefinition.
 * Follows the Agent Skills spec: frontmatter between --- markers.
 */
export function parseSkillMd(raw: string, fallbackId?: string): SkillDefinition {
    const normalized = raw.replace(/\r\n/g, "\n");
    if (!normalized.startsWith("---\n")) {
        throw new Error("SKILL.md missing frontmatter (must start with ---)");
    }

    const end = normalized.indexOf("\n---\n", 4);
    const lastEnd = normalized.endsWith("\n---") ? normalized.length - 4 : -1;
    const closingIdx = end !== -1 ? end : lastEnd;
    if (closingIdx === -1) {
        throw new Error("SKILL.md has malformed frontmatter (missing closing ---)");
    }

    const fm = normalized.slice(4, closingIdx).trim();
    const body = normalized.slice(closingIdx + 4).trim();
    const parsed = SkillFrontmatter.parse(parse(fm));

    return {
        id: parsed.name ?? fallbackId ?? "unknown",
        title: parsed.metadata?.title ?? parsed.name,
        summary: parsed.description,
        hidden: parsed.hidden ?? false,
        content: body,
    };
}
