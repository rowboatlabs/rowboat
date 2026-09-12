import type { RailSelection } from '@/lib/spaces-selection'

// What the ⌘K palette can land on. The palette emits one of these; App maps
// it onto the same entry points the sidebar, the Go menu, and the tour use,
// so every route records history and honours the section gates.

export type PaletteSectionKey =
    | 'home'
    | 'spaces'
    | 'email'
    | 'code'
    | 'meetings'
    | 'brain'
    | 'apps'
    | 'bg-tasks'
    | 'projects'
    | 'chat-history'
    | 'live-notes'
    | 'graph'
    | 'settings'

export interface PaletteSection {
    key: PaletteSectionKey
    label: string
    /** Other names people call it — matched at a discount to the label. */
    keywords: readonly string[]
    /** The Go menu's number key (⌘1…⌘9), when it has one. */
    digit?: number
}

/** Ordered as the Go menu and the dock are. */
export const PALETTE_SECTIONS: readonly PaletteSection[] = [
    { key: 'home', label: 'Todo', keywords: ['home', 'today'], digit: 1 },
    { key: 'spaces', label: 'Spaces', keywords: ['servers', 'channels', 'messages'], digit: 2 },
    { key: 'email', label: 'Email', keywords: ['mail', 'inbox'], digit: 3 },
    { key: 'code', label: 'Code', keywords: ['coding', 'sessions', 'worktrees'], digit: 4 },
    { key: 'meetings', label: 'Meetings', keywords: ['calls', 'recordings', 'transcripts'], digit: 5 },
    { key: 'brain', label: 'Brain', keywords: ['knowledge', 'notes', 'files'], digit: 6 },
    { key: 'apps', label: 'Apps', keywords: ['mini apps'], digit: 7 },
    { key: 'bg-tasks', label: 'Background agents', keywords: ['agents', 'tasks', 'automations'], digit: 8 },
    { key: 'projects', label: 'Projects', keywords: ['workspaces'], digit: 9 },
    { key: 'chat-history', label: 'Chat history', keywords: ['chats', 'conversations', 'history'] },
    { key: 'live-notes', label: 'Live notes', keywords: ['live'] },
    { key: 'graph', label: 'Graph', keywords: ['knowledge graph'] },
    { key: 'settings', label: 'Settings', keywords: ['preferences', 'account', 'config'] },
]

export type PaletteDestination =
    | { kind: 'section'; section: PaletteSectionKey }
    /** A space (shared or direct), optionally a selection inside it and a message to land on. */
    | { kind: 'space'; orgId: string; spaceId: string; rail?: RailSelection; messageId?: string }
    | { kind: 'activity'; orgId: string }
    | { kind: 'chat'; sessionId: string }
    /** A code-mode chat: the Code section, focused on this session. */
    | { kind: 'code-session'; sessionId: string }
    /** A Brain note or file, by workspace path. */
    | { kind: 'note'; path: string }

/** What the palette searches. `all` is Spotlight; the rest narrow it. Tab cycles. */
export type PaletteScope = 'all' | 'spaces' | 'chats' | 'brain' | 'code'

export const PALETTE_SCOPES: readonly { key: PaletteScope; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'spaces', label: 'Spaces' },
    { key: 'chats', label: 'Chats' },
    { key: 'brain', label: 'Brain' },
    { key: 'code', label: 'Code' },
]
