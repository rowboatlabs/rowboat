import { z } from "zod";
import { stringify as stringifyYaml } from "yaml";
import { TrackBlockSchema } from "@x/shared/dist/track-block.js";

// Lazily computed so we don't pay the cost unless a skill actually uses the placeholder.
const renderers: Record<string, () => string> = {
    TRACK_BLOCK_SCHEMA: () => stringifyYaml(z.toJSONSchema(TrackBlockSchema)).trimEnd(),
};

const PLACEHOLDER = /\{\{([A-Z_][A-Z0-9_]*)\}\}/g;

export function substitutePlaceholders(content: string): string {
    return content.replace(PLACEHOLDER, (match, key) => {
        const renderer = renderers[key];
        if (!renderer) return match;
        try {
            return renderer();
        } catch (err) {
            console.error(`[skills] placeholder ${key} failed:`, err);
            return match;
        }
    });
}
