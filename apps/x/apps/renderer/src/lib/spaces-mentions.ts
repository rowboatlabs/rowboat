// Detects a genuine @rowboat ADDRESS in an outgoing space-topic message —
// the trigger for invoking the speaker's own agent (spec §8: @rowboat always
// resolves to the speaker's agent; agents act only when addressed).
//
// Address vs. cite rules (ported from buzz's mention scanner): text inside
// code fences, inline code, and quoted lines is writing ABOUT @rowboat, not
// addressing it — stripped before scanning. The mention must sit at a word
// boundary ("email@rowboat.com" never triggers).

export function containsRowboatAddress(body: string): boolean {
    return /(^|[\s([{])@rowboat\b/i.test(stripNonAddressRegions(body))
}

function stripNonAddressRegions(text: string): string {
    return text
        .replace(/```[\s\S]*?(```|$)/g, ' ') // fenced code blocks (incl. unterminated)
        .replace(/`[^`\n]*`/g, ' ') // inline code
        .replace(/^[ \t]*>.*$/gm, ' ') // markdown-quoted lines (citing someone else's message)
}
