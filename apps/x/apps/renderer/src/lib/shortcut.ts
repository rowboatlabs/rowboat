// Platform-correct shortcut labels. The handlers accept metaKey OR ctrlKey
// everywhere, so only the LABEL differs: macOS reads ⌘⇧K, Windows and Linux
// read Ctrl+Shift+K — a ⌘ glyph on a PC keyboard names a key that isn't there.

export const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')

/** A modifier chord's label: `chord('K', { shift: true })` → "⌘⇧K" on Mac, "Ctrl+Shift+K" elsewhere. */
export function chord(key: string, mods: { shift?: boolean; alt?: boolean } = {}): string {
    if (isMac) return `⌘${mods.alt ? '⌥' : ''}${mods.shift ? '⇧' : ''}${key}`
    return `Ctrl+${mods.alt ? 'Alt+' : ''}${mods.shift ? 'Shift+' : ''}${key}`
}
