// The app's keyboard shortcuts, for showing them (2026-10-21: the sidebar
// shows each row's chord on hover, and tooltips show theirs). The bindings
// themselves live in apps/main/src/menu.ts (menu accelerators) and in the
// renderer's keydown handlers; keep this list in step with those.

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** "mod" is ⌘ on macOS and Ctrl elsewhere. */
export type ShortcutKeys = readonly string[]

export const SHORTCUTS = {
    newChat: ['mod', 'N'],
    search: ['mod', 'K'],
    toggleSidebar: ['mod', 'B'],
    settings: ['mod', ','],
    // Go menu (menu.ts GO_ITEMS): the sidebar's order, top to bottom.
    assistant: ['mod', '1'],
    email: ['mod', '2'],
    meetings: ['mod', '3'],
    todo: ['mod', '4'],
    brain: ['mod', '5'],
    projects: ['mod', '6'],
    agents: ['mod', '7'],
    apps: ['mod', '8'],
    spaces: ['mod', '9'],
} as const satisfies Record<string, ShortcutKeys>

export function keyLabel(key: string): string {
    if (key === 'mod') return IS_MAC ? '⌘' : 'Ctrl'
    if (key === 'shift') return IS_MAC ? '⇧' : 'Shift'
    if (key === 'alt') return IS_MAC ? '⌥' : 'Alt'
    return key
}

/** A rich-text editor (notes, email compose), where ⌘B means bold. Plain
 *  inputs and textareas — the chat box — have no bold, so ⌘B still works there. */
export function isRichTextTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    return Boolean(el?.isContentEditable)
}
