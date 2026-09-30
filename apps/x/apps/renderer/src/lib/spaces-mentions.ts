// The @rowboat trigger reads the mention TOKEN (protocol mentions.ts) through
// @x/shared's face of it; this module keeps the renderer's import path.
export { containsRowboatAddress } from '@x/shared/dist/spaces.js'

/** The member ids a draft's mention tokens name (`[@Name](#member:<id>)`), in order, once each. */
export function mentionedMemberIds(text: string): string[] {
    const ids: string[] = []
    for (const match of text.matchAll(/\]\(#member:([^)\s]+)\)/g)) {
        if (!ids.includes(match[1]!)) ids.push(match[1]!)
    }
    return ids
}
