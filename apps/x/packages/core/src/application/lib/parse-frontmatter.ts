import { parse as parseYaml } from "yaml";

/**
 * Parse the YAML frontmatter from the input string. Returns the frontmatter and content.
 * @param input - The input string to parse.
 * @returns The frontmatter and content.
 */
export function parseFrontmatter(input: string): {
    frontmatter: unknown | null;
    content: string;
} {
    if (input.startsWith("---")) {
        const end = input.indexOf("\n---", 3);

        if (end !== -1) {
            const fm = input.slice(3, end).trim();       // YAML text
            return {
                frontmatter: parseYaml(fm),
                content: input.slice(end + 4).trim(),
            };
        }
    }
    return {
        frontmatter: null,
        content: input,
    };
}