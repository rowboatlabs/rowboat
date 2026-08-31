import { useEffect, useMemo, useRef, useState } from 'react'
import { uploadInputFor } from '@/lib/spaces-upload'
import { ArrowUp, Bot, Clock, FileText, Globe, Loader2, Megaphone, Paperclip, ShieldCheck, Terminal, X as XIcon } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { ModelSelector } from '@/components/model-selector'
import type { ModelSelection } from '@/hooks/use-models'
import { MemberAvatar } from '@/components/spaces/atoms'
import { isDirectImageUrl, useSpaceRefs } from '@/components/spaces/space-markdown'
import { noteEmojiUsed, replaceShortcodes, searchEmoji, type EmojiEntry } from '@/lib/emoji-data'
import { containsRowboatAddress } from '@/lib/spaces-mentions'
import { schedulePresets } from '@/lib/spaces-schedule'
import { blobAppUrl, blobWireUrl, encodeMentions, encodeSpaceLinkTarget, formatBytes, isImageMime } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'

// The space composer. A plain message box — Enter sends, Shift+Enter breaks a
// line — with two things layered on: `@` autocompletes members, @here (notify
// everyone online), @rowboat, and — once a query exists — space files (picked
// files land as plain markdown links),
// and the moment the draft addresses @rowboat, a strip of agent options
// (model · permissions · search · terminal) appears; they ride along with the
// invocation for that one turn. The message itself always goes to the team.
//
// Attachments (paperclip · paste · drag-drop) upload at ATTACH time, not send
// time — send is instant and can't fail on a slow upload (the two-phase upload
// model, spec §6). Chips keep insertion order regardless of completion order;
// send appends each done attachment as a canonical blob link on the wire.

interface AttachmentState {
    id: number
    name: string
    mime: string
    size: number
    status: 'uploading' | 'done' | 'error'
    hash?: string
    /** Pixel dimensions from the org's upload sniff (images) — ride the wire link as ?w=&h=. */
    width?: number
    height?: number
    error?: string
}


/** Per-turn agent options, sent with the invocation when the draft addresses @rowboat. */
export interface AgentOptions {
    model?: { provider: string; model: string; effort?: 'low' | 'medium' | 'high' }
    permissionMode?: 'auto' | 'manual'
    searchEnabled?: boolean
    codeMode?: 'claude' | 'codex'
}

interface MentionCandidate {
    id: string
    label: string
    hint?: string
    isAgent?: boolean
    isBroadcast?: boolean
    /** A file suggestion — picking it inserts a plain markdown link to the path. */
    filePath?: string
}

// "/" so typing into a folder ("@design/sc…") keeps the file query alive.
const MENTION_RE = /(^|[\s([{])@([\w./-]*)$/

/** A pane-provided slash command; `args` absent = picking it runs immediately. */
export interface SlashCommand {
    name: string
    /** Argument placeholder shown in the menu, e.g. '<file>'. */
    args?: string
    hint: string
    run: (args: string) => void | Promise<void>
}

type CommandEntry = Omit<SlashCommand, 'run'> & { run?: SlashCommand['run'] }

/** Built into the composer itself: /ask rewrites to an @rowboat message and sends. */
const ASK_COMMAND: CommandEntry = { name: 'ask', args: '<question>', hint: 'Ask your Rowboat — same as @rowboat' }

/** A draft that IS a command: "/name" or "/name args". */
const COMMAND_RE = /^\/([a-zA-Z]+)(?:\s+([\s\S]*))?$/

export function Composer({ placeholder, onSend, onSchedule, busy, autoFocus, onType, seed, members = [], entries = [], selfMemberId, draftKey, commands = [] }: {
    placeholder: string
    onSend: (body: string, agent?: AgentOptions) => Promise<void>
    /** Send-later: the clock menu hands the built body + fire time here. */
    onSchedule?: (body: string, at: Date) => Promise<void>
    busy: boolean
    autoFocus?: boolean
    /** Called on every keystroke — drives the typing presence lease. */
    onType?: () => void
    /** Prefill (e.g. "Ask @rowboat about this"); a new nonce re-applies it. `append` adds to the draft instead of replacing it. */
    seed?: { text: string; nonce: number; append?: boolean } | null
    /** Space members, for @ autocomplete. */
    members?: spaces.Member[]
    /** Space files — the same @ autocomplete offers them; picking one links it. */
    entries?: spaces.SpacesAssetEntry[]
    selfMemberId?: string
    /**
     * Persist the unsent text under this key (per install, like read marks) —
     * switching spaces or restarting the app hands the draft back. Sending
     * clears it. Attachments are not persisted; they re-upload on return.
     */
    draftKey?: string
    /** Surface-specific slash commands (a "/" draft opens the menu; /ask is built in). */
    commands?: SlashCommand[]
}) {
    const [draft, setDraft] = useState(() => (draftKey ? window.localStorage.getItem(`spaces:draft:${draftKey}`) ?? '' : ''))
    useEffect(() => {
        if (!draftKey) return
        try {
            if (draft) window.localStorage.setItem(`spaces:draft:${draftKey}`, draft)
            else window.localStorage.removeItem(`spaces:draft:${draftKey}`)
        } catch {
            // Quota/private mode: the draft just doesn't persist.
        }
    }, [draftKey, draft])
    const [appliedSeed, setAppliedSeed] = useState<number | null>(null)
    const ref = useRef<HTMLTextAreaElement | null>(null)

    // --- attachments ---------------------------------------------------------
    const refs = useSpaceRefs()
    const [attachments, setAttachments] = useState<AttachmentState[]>([])
    const attachmentIdRef = useRef(0)
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    // Depth counter so nested dragenter/dragleave can't flicker the overlay.
    const dragDepthRef = useRef(0)
    const [dragOver, setDragOver] = useState(false)

    const addFiles = (files: File[]) => {
        if (!refs || files.length === 0) return
        for (const file of files) {
            const id = ++attachmentIdRef.current
            const name = file.name || 'pasted-image.png'
            // The chip appears immediately in drop order; the upload fills it in
            // whenever it completes (slot reservation, so order is stable).
            setAttachments((prev) => [
                ...prev,
                { id, name, mime: file.type || 'application/octet-stream', size: file.size, status: 'uploading' },
            ])
            void (async () => {
                try {
                    const input = await uploadInputFor(file)
                    const res = await window.ipc.invoke('spaces:uploadBlob', {
                        orgId: refs.orgId,
                        spaceId: refs.spaceId,
                        ...input,
                        name,
                        ...(file.type ? { mime: file.type } : {}),
                    })
                    setAttachments((prev) =>
                        prev.map((a) => (a.id === id
                            ? {
                                  ...a,
                                  status: 'done',
                                  hash: res.blob.hash,
                                  mime: res.blob.mime,
                                  size: res.blob.size,
                                  ...(res.blob.width && res.blob.height ? { width: res.blob.width, height: res.blob.height } : {}),
                              }
                            : a)),
                    )
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'upload failed'
                    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'error', error: message } : a)))
                    toast(`Could not upload ${name}: ${message}`, 'error')
                }
            })()
        }
    }

    const removeAttachment = (id: number) => setAttachments((prev) => prev.filter((a) => a.id !== id))
    const uploading = attachments.some((a) => a.status === 'uploading')

    const dragHasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
    const onDragEnter = (e: React.DragEvent) => {
        if (!refs || !dragHasFiles(e)) return
        e.preventDefault()
        dragDepthRef.current += 1
        setDragOver(true)
    }
    const onDragLeave = (e: React.DragEvent) => {
        if (!refs || !dragHasFiles(e)) return
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setDragOver(false)
    }
    const onDrop = (e: React.DragEvent) => {
        if (!refs || !dragHasFiles(e)) return
        e.preventDefault()
        dragDepthRef.current = 0
        setDragOver(false)
        addFiles(Array.from(e.dataTransfer.files))
    }
    const onPaste = (e: React.ClipboardEvent) => {
        if (refs) {
            const files = Array.from(e.clipboardData.items)
                .filter((item) => item.kind === 'file')
                .map((item) => item.getAsFile())
                .filter((f): f is File => f !== null)
            if (files.length > 0) {
                e.preventDefault()
                addFiles(files)
                return
            }
        }
        // A pasted direct image address (a GIF link) becomes the image, not
        // the URL text — markdown image syntax, nothing re-hosted: the message
        // keeps pointing at the original. Only when the paste IS the URL;
        // a URL inside a sentence stays as typed.
        const text = e.clipboardData.getData('text/plain').trim()
        if (!text || /\s/.test(text) || !isDirectImageUrl(text)) return
        e.preventDefault()
        const el = ref.current
        const start = el?.selectionStart ?? draft.length
        const end = el?.selectionEnd ?? draft.length
        const inserted = `![](${text})`
        setDraft(draft.slice(0, start) + inserted + draft.slice(end))
        onType?.()
        requestAnimationFrame(() => {
            const node = ref.current
            if (!node) return
            const pos = start + inserted.length
            node.setSelectionRange(pos, pos)
        })
    }

    // Agent options — only meaningful (and only shown) when @rowboat is addressed.
    const [model, setModel] = useState<ModelSelection | null>(null)
    const [permissionMode, setPermissionMode] = useState<'auto' | 'manual'>('auto')
    const [searchEnabled, setSearchEnabled] = useState(false)
    const [codeMode, setCodeMode] = useState<'claude' | 'codex' | null>(null)
    const [codeModeAvailable, setCodeModeAvailable] = useState(false)
    useEffect(() => {
        const load = () => {
            window.ipc.invoke('codeMode:getConfig', null)
                .then((r) => setCodeModeAvailable(r.enabled))
                .catch(() => setCodeModeAvailable(false))
        }
        load()
        window.addEventListener('code-mode-config-changed', load)
        return () => window.removeEventListener('code-mode-config-changed', load)
    }, [])

    // Apply a new seed during render (React's adjust-state-on-prop-change pattern).
    if (seed && seed.nonce !== appliedSeed) {
        setAppliedSeed(seed.nonce)
        // Append (the profile popover's "Mention") joins a draft in progress;
        // a plain seed replaces it (quote-reply, ask-rowboat).
        setDraft(seed.append && draft ? `${draft}${/\s$/.test(draft) ? '' : ' '}${seed.text}` : seed.text)
    }
    const seedNonce = seed?.nonce ?? null
    useEffect(() => {
        if (seedNonce === null) return
        const el = ref.current
        if (!el) return
        el.focus()
        const end = el.value.length
        el.setSelectionRange(end, end)
    }, [seedNonce])

    // --- @ autocomplete ------------------------------------------------------
    const [caret, setCaret] = useState(0)
    const [mentionOpen, setMentionOpen] = useState(false)
    const [mentionIndex, setMentionIndex] = useState(0)
    const mentionMatch = useMemo(() => {
        if (!mentionOpen) return null
        const before = draft.slice(0, caret)
        const m = MENTION_RE.exec(before)
        if (!m) return null
        return { query: (m[2] ?? '').toLowerCase(), start: caret - (m[2]?.length ?? 0) - 1 }
    }, [draft, caret, mentionOpen])
    const candidates = useMemo<MentionCandidate[]>(() => {
        if (!mentionMatch) return []
        const q = mentionMatch.query
        const people: MentionCandidate[] = []
        if ('rowboat'.startsWith(q)) people.push({ id: 'rowboat', label: 'rowboat', hint: 'your agent — acts only when asked', isAgent: true })
        if ('here'.startsWith(q)) people.push({ id: 'here', label: 'here', hint: 'notify everyone online', isBroadcast: true })
        for (const m of members) {
            const hay = `${m.id} ${m.displayName}`.toLowerCase()
            if (!q || hay.includes(q)) people.push({ id: m.id, label: m.displayName, ...(m.id === selfMemberId ? { hint: 'you' } : {}) })
        }
        // Files join once a query exists (a bare "@" is a people gesture);
        // picking one inserts a markdown link, not a mention.
        const files: MentionCandidate[] = q
            ? entries
                  .filter((e) => e.state !== 'deleted' && e.path.toLowerCase().includes(q))
                  .slice(0, 4)
                  .map((e) => ({
                      id: `file:${e.path}`,
                      label: e.path.split('/').pop() ?? e.path,
                      ...(e.path.includes('/') ? { hint: e.path } : {}),
                      filePath: e.path,
                  }))
            : []
        return [...people.slice(0, 8 - files.length), ...files]
    }, [mentionMatch, members, entries, selfMemberId])
    // Reset the highlighted row whenever the query changes (adjust-on-change, not an effect).
    const mentionQuery = mentionMatch?.query ?? null
    const [lastQuery, setLastQuery] = useState<string | null>(null)
    if (mentionQuery !== lastQuery) {
        setLastQuery(mentionQuery)
        setMentionIndex(0)
    }
    const showMentions = mentionOpen && !!mentionMatch && candidates.length > 0

    // --- :emoji: autocomplete ------------------------------------------------
    // ":fi" at the caret offers 🔥 etc.; a completed ":fire:" left as text
    // still converts at send time (replaceShortcodes).
    const emojiMatch = useMemo(() => {
        const m = /(^|[\s([{]):([a-z0-9_+-]{2,})$/.exec(draft.slice(0, caret))
        if (!m) return null
        return { query: m[2]!, start: caret - m[2]!.length - 1 }
    }, [draft, caret])
    const emojiCandidates = useMemo<EmojiEntry[]>(() => (emojiMatch ? searchEmoji(emojiMatch.query, 8) : []), [emojiMatch])
    const [emojiIndex, setEmojiIndex] = useState(0)
    const [emojiDismissed, setEmojiDismissed] = useState(false)
    const emojiQuery = emojiMatch?.query ?? null
    const [lastEmojiQuery, setLastEmojiQuery] = useState<string | null>(null)
    if (emojiQuery !== lastEmojiQuery) {
        setLastEmojiQuery(emojiQuery)
        setEmojiIndex(0)
        setEmojiDismissed(false)
    }
    const pickEmoji = (entry: EmojiEntry) => {
        if (!emojiMatch) return
        noteEmojiUsed(entry.e)
        insertAt(emojiMatch.start, caret, `${entry.e} `)
    }

    // --- slash commands ------------------------------------------------------
    // "/name" (no space yet) filters the menu; "/name args" pins the matched
    // command's usage hint above the box; Enter runs it via send().
    const allCommands: CommandEntry[] = [ASK_COMMAND, ...commands]
    const cmdMenuMatch = /^\/([a-zA-Z]*)$/.exec(draft)
    const cmdQuery = cmdMenuMatch?.[1]?.toLowerCase() ?? null
    const cmdCandidates = cmdQuery !== null ? allCommands.filter((c) => c.name.startsWith(cmdQuery)) : []
    const [cmdIndex, setCmdIndex] = useState(0)
    const [cmdDismissed, setCmdDismissed] = useState(false)
    const [lastCmdQuery, setLastCmdQuery] = useState<string | null>(null)
    if (cmdQuery !== lastCmdQuery) {
        setLastCmdQuery(cmdQuery)
        setCmdIndex(0)
        setCmdDismissed(false)
    }
    const showCommands = !showMentions && !cmdDismissed && cmdCandidates.length > 0
    const showEmoji = !showMentions && !showCommands && !emojiDismissed && emojiCandidates.length > 0
    const activeCommand = (() => {
        const m = /^\/([a-zA-Z]+)\s/.exec(draft)
        return m ? allCommands.find((c) => c.name === m[1]!.toLowerCase()) ?? null : null
    })()

    const pickCommand = (c: CommandEntry) => {
        if (c.args) {
            // Complete to "/name " — the person types the argument, Enter runs.
            const next = `/${c.name} `
            setDraft(next)
            requestAnimationFrame(() => {
                const el = ref.current
                if (!el) return
                el.focus()
                el.setSelectionRange(next.length, next.length)
                setCaret(next.length)
            })
        } else {
            setDraft('')
            if (c.run) void c.run('')
        }
    }

    const insertAt = (start: number, end: number, text: string) => {
        const next = `${draft.slice(0, start)}${text}${draft.slice(end)}`
        setDraft(next)
        setMentionOpen(false)
        requestAnimationFrame(() => {
            const el = ref.current
            if (!el) return
            el.focus()
            const pos = start + text.length
            el.setSelectionRange(pos, pos)
            setCaret(pos)
        })
    }
    // The draft shows the person's name; send() encodes it back to the wire
    // address @<memberId> (what notifications and agent invocation scan for).
    // A file inserts a plain markdown link — relative links in messages mean
    // space files, standard syntax on the wire.
    const pickCandidate = (c: MentionCandidate) => {
        if (!mentionMatch) return
        if (c.filePath) insertAt(mentionMatch.start, caret, `[${c.filePath}](${encodeSpaceLinkTarget(c.filePath)}) `)
        else insertAt(mentionMatch.start, caret, `@${c.label} `)
    }

    // Markdown formatting shortcuts (⌘B bold, ⌘I italic, ⌘E code, ⌘⇧X
    // strikethrough): wrap the selection — or an empty caret — in the marker;
    // fired again on an already-wrapped selection, unwrap (toggle).
    const wrapSelection = (marker: string) => {
        const el = ref.current
        if (!el) return
        const start = el.selectionStart ?? 0
        const end = el.selectionEnd ?? start
        const selected = draft.slice(start, end)
        const before = draft.slice(0, start)
        const after = draft.slice(end)
        const place = (next: string, selStart: number, selEnd: number) => {
            setDraft(next)
            requestAnimationFrame(() => {
                el.focus()
                el.setSelectionRange(selStart, selEnd)
                setCaret(selEnd)
            })
        }
        if (before.endsWith(marker) && after.startsWith(marker)) {
            place(`${before.slice(0, -marker.length)}${selected}${after.slice(marker.length)}`, start - marker.length, end - marker.length)
        } else if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
            const inner = selected.slice(marker.length, selected.length - marker.length)
            place(`${before}${inner}${after}`, start, start + inner.length)
        } else {
            // Empty caret lands between the markers, ready to type.
            place(`${before}${marker}${selected}${marker}${after}`, start + marker.length, end + marker.length)
        }
    }

    const insertRowboatChip = () => {
        const el = ref.current
        const mention = '@rowboat '
        if (!el) {
            setDraft((d) => (d.includes('@rowboat') ? d : `${mention}${d}`))
            return
        }
        const start = el.selectionStart ?? draft.length
        const end = el.selectionEnd ?? draft.length
        const before = draft.slice(0, start)
        const needsSpace = before.length > 0 && !/\s$/.test(before)
        insertAt(start, end, `${needsSpace ? ' ' : ''}${mention}`)
    }

    // --- send ----------------------------------------------------------------
    const mentioned = containsRowboatAddress(draft)

    /** The one body builder — send and send-later produce identical wire text. */
    const buildBody = (raw: string): string => {
        const ready = attachments.filter((a) => a.status === 'done' && a.hash)
        const text = encodeMentions(replaceShortcodes(raw), members)
        const attachmentLines = refs
            ? ready.map((a) => {
                  const dims = a.width && a.height ? { width: a.width, height: a.height } : undefined
                  return isImageMime(a.mime)
                      ? `![${a.name}](${blobWireUrl(refs, a.hash!, a.name, dims)})`
                      : `[${a.name}](${blobWireUrl(refs, a.hash!, a.name)})`
              })
            : []
        return [text, attachmentLines.join('\n')].filter(Boolean).join('\n\n')
    }

    const scheduleDraft = async (at: Date) => {
        if (!onSchedule || busy || uploading) return
        const raw = draft.trim()
        const m = COMMAND_RE.exec(raw)
        if (m && allCommands.some((c) => c.name === m[1]!.toLowerCase())) {
            toast('Commands run now — schedule a plain message instead', 'info')
            return
        }
        const body = buildBody(raw)
        if (!body) return
        await onSchedule(body, at)
        setDraft('')
        setAttachments([])
        setMentionOpen(false)
    }

    const send = async (textOverride?: string) => {
        if (busy || uploading) return
        const raw = (textOverride ?? draft).trim()
        // A command draft executes instead of posting. Unknown names fall
        // through and send as literal text — "/shrug" is somebody's message.
        if (textOverride === undefined) {
            const m = COMMAND_RE.exec(raw)
            const found = m ? allCommands.find((c) => c.name === m[1]!.toLowerCase()) : undefined
            if (m && found) {
                const args = (m[2] ?? '').trim()
                if (!args && found.args) {
                    toast(`Usage: /${found.name} ${found.args}`, 'info')
                    return
                }
                if (found.run) {
                    setDraft('')
                    await found.run(args)
                    return
                }
                // Built-in /ask: rewrite and send through the normal path.
                await send(`@rowboat ${args}`)
                return
            }
        }
        // Each attachment lands on the wire as a canonical blob link (images
        // inline, the rest as download cards), in its own paragraph — see
        // buildBody, shared with send-later.
        const body = buildBody(raw)
        if (!body) return
        // From the text actually going out — an /ask rewrite mentions @rowboat
        // even though the draft it came from didn't.
        const agent: AgentOptions | undefined = containsRowboatAddress(raw)
            ? {
                  ...(model ? { model: { provider: model.provider, model: model.model, ...(model.effort ? { effort: model.effort } : {}) } } : {}),
                  permissionMode,
                  ...(searchEnabled ? { searchEnabled: true } : {}),
                  ...(codeMode ? { codeMode } : {}),
              }
            : undefined
        await onSend(body, agent)
        setDraft('')
        setAttachments([])
        setMentionOpen(false)
    }

    return (
        <div className="px-3 pb-3 pt-1 shrink-0">
            <div
                className="relative rounded-xl border border-border bg-background shadow-sm focus-within:border-foreground/30"
                onDragEnter={onDragEnter}
                onDragOver={(e) => { if (refs && dragHasFiles(e)) e.preventDefault() }}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                {dragOver && (
                    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-foreground/40 bg-background/90 text-sm text-muted-foreground">
                        Drop to attach
                    </div>
                )}
                {showCommands && (
                    <div className="absolute bottom-full left-0 right-0 z-20 mb-1.5 overflow-hidden rounded-xl border border-border bg-background p-1.5 shadow-sm">
                        {cmdCandidates.map((c, i) => (
                            <button
                                key={c.name}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => pickCommand(c)}
                                className={cn('flex w-full items-baseline gap-2.5 rounded-lg px-3 py-2 text-left', i === cmdIndex ? 'bg-accent' : 'hover:bg-accent/60')}
                            >
                                <span className="shrink-0 font-mono text-sm font-medium">/{c.name}</span>
                                {c.args && <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.args}</span>}
                                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{c.hint}</span>
                            </button>
                        ))}
                        <div className="px-3 pb-1 pt-1.5 text-[11px] text-muted-foreground/80">↑↓ · ↵ or ⇥ to pick · esc</div>
                    </div>
                )}
                {!showCommands && activeCommand && !showMentions && (
                    <div className="absolute bottom-full left-0 right-0 z-20 mb-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground shadow-sm">
                        <span className="font-mono text-sm font-medium text-foreground">/{activeCommand.name}</span>
                        {activeCommand.args && <span className="font-mono text-sm"> {activeCommand.args}</span>} — {activeCommand.hint} · ↵ to run
                    </div>
                )}
                {showEmoji && (
                    <div className="absolute bottom-full left-2 z-20 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md">
                        {emojiCandidates.map((c, i) => (
                            <button
                                key={c.n}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => pickEmoji(c)}
                                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1 text-left', i === emojiIndex ? 'bg-accent' : 'hover:bg-accent/60')}
                            >
                                <span className="text-base leading-none">{c.e}</span>
                                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">:{c.n}:</span>
                            </button>
                        ))}
                        <div className="px-2 pb-0.5 pt-1 text-[10.5px] text-muted-foreground/80">↑↓ · ↵ or ⇥ to pick · esc</div>
                    </div>
                )}
                {showMentions && (
                    <div className="absolute bottom-full left-2 z-20 mb-1 w-72 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md">
                        {candidates.map((c, i) => (
                            <button
                                key={c.id}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => pickCandidate(c)}
                                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', i === mentionIndex ? 'bg-accent' : 'hover:bg-accent/60')}
                            >
                                {c.isAgent ? (
                                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background"><Bot className="size-3.5" /></span>
                                ) : c.isBroadcast ? (
                                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Megaphone className="size-3.5" /></span>
                                ) : c.filePath ? (
                                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><FileText className="size-3.5" /></span>
                                ) : (
                                    <MemberAvatar id={c.id} name={c.label} size="sm" className="size-6 text-[10px]" />
                                )}
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[13px] font-medium">{c.label}</span>
                                    {c.hint && <span className="block truncate text-[11px] text-muted-foreground">{c.hint}</span>}
                                </span>
                            </button>
                        ))}
                        <div className="px-2 pb-0.5 pt-1 text-[10.5px] text-muted-foreground/80">↑↓ · ↵ or ⇥ to pick · esc</div>
                    </div>
                )}
                {attachments.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 px-2.5 pt-2">
                        {attachments.map((a) => (
                            <span
                                key={a.id}
                                title={a.status === 'error' ? a.error : `${a.name} · ${formatBytes(a.size)}`}
                                className={cn(
                                    'inline-flex max-w-56 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs',
                                    a.status === 'error' ? 'border-red-300 text-red-600 dark:border-red-800 dark:text-red-400' : 'border-border text-foreground/90',
                                )}
                            >
                                {a.status === 'uploading' ? (
                                    <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                                ) : refs && a.hash && isImageMime(a.mime) ? (
                                    <img src={blobAppUrl({ orgId: refs.orgId, spaceId: refs.spaceId }, a.hash, { thumb: 64 })} alt="" className="size-5 shrink-0 rounded object-cover" />
                                ) : (
                                    <FileText className="size-3 shrink-0 text-muted-foreground" />
                                )}
                                <span className="truncate">{a.name}</span>
                                <span className="shrink-0 text-[10px] text-muted-foreground">{a.status === 'uploading' ? 'uploading…' : a.status === 'error' ? 'failed' : formatBytes(a.size)}</span>
                                <button
                                    type="button"
                                    onClick={() => removeAttachment(a.id)}
                                    aria-label={`Remove ${a.name}`}
                                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                    <XIcon className="size-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
                <Textarea
                    ref={ref}
                    autoFocus={autoFocus}
                    value={draft}
                    placeholder={placeholder}
                    rows={1}
                    className="min-h-9 max-h-40 resize-none border-0 bg-transparent dark:bg-transparent px-3 pt-2.5 pb-1 text-sm shadow-none focus-visible:ring-0 field-sizing-content"
                    onPaste={onPaste}
                    onChange={(e) => {
                        setDraft(e.target.value)
                        const pos = e.target.selectionStart ?? e.target.value.length
                        setCaret(pos)
                        // Open on "@" at a word start; stay open while the query grows.
                        setMentionOpen(MENTION_RE.test(e.target.value.slice(0, pos)))
                        onType?.()
                    }}
                    onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                    onKeyDown={(e) => {
                        if (showCommands) {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault()
                                setCmdIndex((i) => (i + 1) % cmdCandidates.length)
                                return
                            }
                            if (e.key === 'ArrowUp') {
                                e.preventDefault()
                                setCmdIndex((i) => (i - 1 + cmdCandidates.length) % cmdCandidates.length)
                                return
                            }
                            if (e.key === 'Enter' || e.key === 'Tab') {
                                e.preventDefault()
                                const c = cmdCandidates[cmdIndex]
                                if (c) pickCommand(c)
                                return
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault()
                                setCmdDismissed(true)
                                return
                            }
                        }
                        if (showMentions) {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault()
                                setMentionIndex((i) => (i + 1) % candidates.length)
                                return
                            }
                            if (e.key === 'ArrowUp') {
                                e.preventDefault()
                                setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length)
                                return
                            }
                            if (e.key === 'Enter' || e.key === 'Tab') {
                                e.preventDefault()
                                const c = candidates[mentionIndex]
                                if (c) pickCandidate(c)
                                return
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault()
                                setMentionOpen(false)
                                return
                            }
                        }
                        if (showEmoji) {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault()
                                setEmojiIndex((i) => (i + 1) % emojiCandidates.length)
                                return
                            }
                            if (e.key === 'ArrowUp') {
                                e.preventDefault()
                                setEmojiIndex((i) => (i - 1 + emojiCandidates.length) % emojiCandidates.length)
                                return
                            }
                            if (e.key === 'Enter' || e.key === 'Tab') {
                                e.preventDefault()
                                const c = emojiCandidates[emojiIndex]
                                if (c) pickEmoji(c)
                                return
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault()
                                setEmojiDismissed(true)
                                return
                            }
                        }
                        if ((e.metaKey || e.ctrlKey) && !e.altKey) {
                            const key = e.key.toLowerCase()
                            const marker = e.shiftKey
                                ? key === 'x' ? '~~' : null
                                : key === 'b' ? '**' : key === 'i' ? '*' : key === 'e' ? '`' : null
                            if (marker) {
                                e.preventDefault()
                                wrapSelection(marker)
                                return
                            }
                        }
                        // Enter sends; Shift+Enter breaks a line.
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault()
                            void send()
                        }
                    }}
                />
                <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
                    {refs && (
                        <>
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                    addFiles(Array.from(e.target.files ?? []))
                                    e.target.value = ''
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                title="Attach files (or paste / drop them)"
                                className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                                <Paperclip className="size-4" />
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={insertRowboatChip}
                        title="Address your Rowboat — it acts only when asked"
                        className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                            mentioned ? 'bg-foreground text-background' : 'bg-muted text-foreground/80 hover:bg-accent',
                        )}
                    >
                        @rowboat
                    </button>
                    {mentioned && (
                        <>
                            <span className="mx-0.5 h-4 w-px bg-border" />
                            <span className="text-[11px] text-muted-foreground">runs as your Rowboat</span>
                            <ModelSelector value={model} onChange={setModel} defaultOption={{ label: 'Assistant model' }} effortSelectable />
                            <button
                                type="button"
                                onClick={() => setPermissionMode((m) => (m === 'auto' ? 'manual' : 'auto'))}
                                title={permissionMode === 'auto' ? 'Auto-permission on — click for manual approval prompts' : 'Manual approval prompts — click for auto-permission'}
                                className={cn(
                                    'flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors',
                                    permissionMode === 'auto' ? 'bg-secondary text-foreground hover:bg-secondary/70' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                                )}
                            >
                                <ShieldCheck className="size-3.5 shrink-0" />
                                <span>{permissionMode === 'auto' ? 'Auto' : 'Manual'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setSearchEnabled((v) => !v)}
                                aria-pressed={searchEnabled}
                                title="Web search"
                                className={cn(
                                    'flex h-7 shrink-0 items-center rounded-full border px-1.5 transition-colors',
                                    searchEnabled
                                        ? 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400 dark:hover:bg-blue-900'
                                        : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                                )}
                            >
                                <Globe className="size-4 shrink-0" />
                                {searchEnabled && <span className="ml-1.5 text-xs font-medium">Search</span>}
                            </button>
                            {codeModeAvailable && (
                                <button
                                    type="button"
                                    onClick={() => setCodeMode((m) => (m ? null : 'claude'))}
                                    aria-pressed={!!codeMode}
                                    title={codeMode ? 'Terminal on (Claude Code) — click to turn off' : 'Let it use the terminal / code tools'}
                                    className={cn(
                                        'flex h-7 shrink-0 items-center rounded-full border px-1.5 transition-colors',
                                        codeMode ? 'bg-secondary text-foreground border-transparent hover:bg-secondary/70' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                                    )}
                                >
                                    <Terminal className="size-4 shrink-0" />
                                    {codeMode && <span className="ml-1.5 text-xs font-medium">Terminal</span>}
                                </button>
                            )}
                        </>
                    )}
                    <div className="flex-1" />
                    {onSchedule && (draft.trim() || attachments.some((a) => a.status === 'done')) && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    title="Send later"
                                    disabled={busy || uploading}
                                    className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                                >
                                    <Clock className="size-4" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {schedulePresets().map((p) => (
                                    <DropdownMenuItem key={p.label} onClick={() => void scheduleDraft(p.at)}>
                                        {p.label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                    <button
                        type="button"
                        onClick={() => void send()}
                        disabled={busy || uploading || (!draft.trim() && !attachments.some((a) => a.status === 'done'))}
                        aria-label="Send"
                        title={uploading ? 'Waiting for uploads…' : 'Send (↵ · Shift+↵ for a new line)'}
                        className="inline-flex size-7 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-30 transition-opacity"
                    >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
                    </button>
                </div>
            </div>
        </div>
    )
}
