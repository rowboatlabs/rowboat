import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import { uploadInputFor } from '@/lib/spaces-upload'
import { ArrowUp, BarChart3, Bot, Clock, FileText, Globe, Loader2, Megaphone, Paperclip, ShieldCheck, Terminal, X as XIcon } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ModelSelector } from '@/components/model-selector'
import type { ModelSelection } from '@/hooks/use-models'
import { MemberAvatar } from '@/components/spaces/atoms'
import { caretContext, composerExtensions, composerMarkdown, type CaretContext } from '@/components/spaces/composer-editor'
import { RichFormattingToolbar } from '@/components/spaces/composer-toolbar'
import { isDirectImageUrl, useSpaceRefs } from '@/components/spaces/space-markdown'
import '@/styles/space-composer.css'
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

export function Composer({ placeholder, onSend, onSchedule, onCreatePoll, busy, autoFocus, onType, seed, members = [], entries = [], selfMemberId, draftKey, commands = [] }: {
    placeholder: string
    onSend: (body: string, agent?: AgentOptions) => Promise<void>
    /** Send-later: the clock menu hands the built body + fire time here. */
    onSchedule?: (body: string, at: Date) => Promise<void>
    /** Opens the poll creation dialog (same flow as /poll) — the button beside attach. */
    onCreatePoll?: () => void
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

    // ------------------------------------------------------------------
    // The rich input (TipTap). The editor owns what you see; `draft` is the
    // serialized markdown mirror, re-derived on every update, so drafts,
    // slash commands, @rowboat detection and buildBody all keep reading the
    // exact string a textarea used to hold. Editor callbacks go through
    // latest-closure refs — the instance is created once per mount.
    // ------------------------------------------------------------------
    const placeholderRef = useRef(placeholder)
    const onTypeRef = useRef(onType)
    const keydownRef = useRef<(view: EditorView, event: KeyboardEvent) => boolean>(() => false)
    const pasteRef = useRef<(event: ClipboardEvent) => boolean>(() => false)
    const dropRef = useRef<(event: DragEvent) => boolean>(() => false)
    /** Where the caret sits (text-before-caret + doc position) — drives the autocompletes. */
    const [context, setContext] = useState<CaretContext | null>(null)
    const [mentionOpen, setMentionOpen] = useState(false)

    const editor = useEditor({
        // The getter runs inside Placeholder's decoration pass (post-render,
        // in the editor), never during this render — a false positive here.
        // eslint-disable-next-line react-hooks/refs
        extensions: composerExtensions(() => placeholderRef.current),
        content: draft,
        autofocus: autoFocus ? 'end' : false,
        editorProps: {
            handleKeyDown: (view, event) => keydownRef.current(view, event),
            handlePaste: (_view, event) => pasteRef.current(event),
            handleDrop: (_view, event) => dropRef.current(event),
        },
        onUpdate: ({ editor: ed }) => {
            setDraft(composerMarkdown(ed))
            const ctx = caretContext(ed)
            setContext(ctx)
            // Open on "@" at a word start; stay open while the query grows.
            setMentionOpen(!!ctx && MENTION_RE.test(ctx.text))
            onTypeRef.current?.()
        },
        onSelectionUpdate: ({ editor: ed }) => setContext(caretContext(ed)),
    })

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
    // Pasted files attach; a pasted direct image address (a GIF link) becomes
    // the image itself, nothing re-hosted — but only when the paste IS the
    // URL; a URL inside a sentence stays as typed.
    const handleEditorPaste = (event: ClipboardEvent): boolean => {
        const data = event.clipboardData
        if (refs && data) {
            const files = Array.from(data.items)
                .filter((item) => item.kind === 'file')
                .map((item) => item.getAsFile())
                .filter((f): f is File => f !== null)
            if (files.length > 0) {
                addFiles(files)
                return true
            }
        }
        const text = data?.getData('text/plain').trim() ?? ''
        if (text && !/\s/.test(text) && isDirectImageUrl(text) && editor) {
            editor.chain().focus().insertContent({ type: 'image', attrs: { src: text } }).run()
            return true
        }
        return false
    }
    // Files dropped on the editor belong to the container's drop handler (the
    // overlay + addFiles above) — only stop ProseMirror from inserting.
    const editorDropGuard = (event: DragEvent): boolean =>
        !!(refs && event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files'))

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

    // Apply a new seed by rebuilding the doc from its markdown. Append (the
    // profile popover's "Mention") joins a draft in progress; a plain seed
    // replaces it (quote-reply, ask-rowboat). Caret lands at the end.
    useEffect(() => {
        if (!editor || !seed || seed.nonce === appliedSeed) return
        setAppliedSeed(seed.nonce)
        const current = composerMarkdown(editor)
        const next = seed.append && current ? `${current}${/\s$/.test(current) ? '' : ' '}${seed.text}` : seed.text
        editor.commands.setContent(next)
        setDraft(composerMarkdown(editor))
        editor.commands.focus('end')
    }, [editor, seed, appliedSeed])

    // --- @ autocomplete ------------------------------------------------------
    const [mentionIndex, setMentionIndex] = useState(0)
    const mentionMatch = useMemo(() => {
        if (!mentionOpen || !context) return null
        const m = MENTION_RE.exec(context.text)
        if (!m) return null
        const query = m[2] ?? ''
        return { query: query.toLowerCase(), from: context.from - query.length - 1, to: context.from }
    }, [context, mentionOpen])
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
        if (!context) return null
        const m = /(^|[\s([{]):([a-z0-9_+-]{2,})$/.exec(context.text)
        if (!m) return null
        return { query: m[2]!, from: context.from - m[2]!.length - 1, to: context.from }
    }, [context])
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
        if (!emojiMatch || !editor) return
        noteEmojiUsed(entry.e)
        editor.chain().focus().deleteRange({ from: emojiMatch.from, to: emojiMatch.to }).insertContent({ type: 'text', text: `${entry.e} ` }).run()
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
        if (!editor) return
        if (c.args) {
            // Complete to "/name " — the person types the argument, Enter runs.
            editor.chain().focus().clearContent().insertContent({ type: 'text', text: `/${c.name} ` }).run()
        } else {
            editor.chain().clearContent().run()
            if (c.run) void c.run('')
        }
    }

    // The draft shows the person's name; send() encodes it back to the wire
    // address @<memberId> (what notifications and agent invocation scan for).
    // A file becomes a live link to the space path — standard markdown on the
    // wire. Inserted as literal nodes, never re-parsed as markdown.
    const pickCandidate = (c: MentionCandidate) => {
        if (!mentionMatch || !editor) return
        const chain = editor.chain().focus().deleteRange({ from: mentionMatch.from, to: mentionMatch.to })
        if (c.filePath) {
            chain.insertContent([
                { type: 'text', text: c.filePath, marks: [{ type: 'link', attrs: { href: encodeSpaceLinkTarget(c.filePath) } }] },
                { type: 'text', text: ' ' },
            ]).run()
        } else {
            chain.insertContent({ type: 'text', text: `@${c.label} ` }).run()
        }
        setMentionOpen(false)
    }

    const insertRowboatChip = () => {
        if (!editor) return
        const { $from, empty } = editor.state.selection
        const before = empty && $from.parent.isTextblock ? $from.parent.textBetween(0, $from.parentOffset, ' ', ' ') : ''
        const needsSpace = before.length > 0 && !/\s$/.test(before)
        editor.chain().focus().insertContent({ type: 'text', text: `${needsSpace ? ' ' : ''}@rowboat ` }).run()
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
        editor?.chain().clearContent().run()
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
                    editor?.chain().clearContent().run()
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
        editor?.chain().clearContent().run()
        setDraft('')
        setAttachments([])
        setMentionOpen(false)
    }

    // The editor's keydown: popover navigation first (it must beat every
    // editor keymap), then the send keys. Formatting chords live in the
    // editor's own extensions. Returning true consumes the event.
    const handleEditorKeyDown = (view: EditorView, e: KeyboardEvent): boolean => {
        if (showCommands) {
            if (e.key === 'ArrowDown') {
                setCmdIndex((i) => (i + 1) % cmdCandidates.length)
                return true
            }
            if (e.key === 'ArrowUp') {
                setCmdIndex((i) => (i - 1 + cmdCandidates.length) % cmdCandidates.length)
                return true
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                const c = cmdCandidates[cmdIndex]
                if (c) pickCommand(c)
                return true
            }
            if (e.key === 'Escape') {
                setCmdDismissed(true)
                return true
            }
        }
        if (showMentions) {
            if (e.key === 'ArrowDown') {
                setMentionIndex((i) => (i + 1) % candidates.length)
                return true
            }
            if (e.key === 'ArrowUp') {
                setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length)
                return true
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                const c = candidates[mentionIndex]
                if (c) pickCandidate(c)
                return true
            }
            if (e.key === 'Escape') {
                setMentionOpen(false)
                return true
            }
        }
        if (showEmoji) {
            if (e.key === 'ArrowDown') {
                setEmojiIndex((i) => (i + 1) % emojiCandidates.length)
                return true
            }
            if (e.key === 'ArrowUp') {
                setEmojiIndex((i) => (i - 1 + emojiCandidates.length) % emojiCandidates.length)
                return true
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                const c = emojiCandidates[emojiIndex]
                if (c) pickEmoji(c)
                return true
            }
            if (e.key === 'Escape') {
                setEmojiDismissed(true)
                return true
            }
        }
        if (e.key !== 'Enter') return false
        // ⌘Enter always sends — even from inside a code fence.
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
            void send()
            return true
        }
        if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && editor) {
            // Shift+Enter continues a list — next item, or out of the list
            // from an empty one; elsewhere the default hard break applies.
            if (editor.isActive('listItem')) {
                const { $from } = editor.state.selection
                if ($from.parent.textContent === '') return editor.chain().focus().liftListItem('listItem').run()
                return editor.chain().focus().splitListItem('listItem').run()
            }
            return false
        }
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !view.composing) {
            // Inside a code fence Enter breaks the line (the Slack posture);
            // everywhere else it sends.
            if (view.state.selection.$from.parent.type.name === 'codeBlock') return false
            void send()
            return true
        }
        return false
    }

    // The editor reads its callbacks through refs, re-pointed after every
    // render so the closures always see current state (the ref-mirror
    // pattern the notes editor uses).
    useEffect(() => {
        placeholderRef.current = placeholder
        onTypeRef.current = onType
        keydownRef.current = handleEditorKeyDown
        pasteRef.current = handleEditorPaste
        dropRef.current = editorDropGuard
    })

    return (
        <div className="px-3 pb-3 pt-1 shrink-0">
            <div
                className="relative rounded-2xl border border-border bg-background shadow-[0_8px_24px_rgb(0_0_0_/_0.04)]"
                onDragEnter={onDragEnter}
                onDragOver={(e) => { if (refs && dragHasFiles(e)) e.preventDefault() }}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                {dragOver && (
                    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-foreground/40 bg-background/90 text-sm text-muted-foreground">
                        Drop to attach
                    </div>
                )}
                {showCommands && (
                    <div className="absolute bottom-full left-0 right-0 z-20 mb-1.5 overflow-hidden rounded-2xl border-none bg-popover p-1.5 shadow-[var(--rowboat-shadow)]">
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
                    <div className="absolute bottom-full left-0 right-0 z-20 mb-1.5 rounded-2xl border-none bg-popover px-3 py-2 text-xs text-muted-foreground shadow-[var(--rowboat-shadow)]">
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
                    <div className="absolute bottom-full left-2 z-20 mb-1 w-72 overflow-hidden rounded-2xl border-none bg-popover p-1.5 shadow-[var(--rowboat-shadow)]">
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
                {/* The formatting bar rides the top edge, Slack-style. */}
                <RichFormattingToolbar editor={editor} className="px-2 pt-1.5" />
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
                {/* The rich input. What you see is what sends — the doc
                    serializes back to wire markdown on every update. */}
                <EditorContent editor={editor} className="space-composer" />
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
                    {onCreatePoll && (
                        <button
                            type="button"
                            onClick={onCreatePoll}
                            title="Create a poll"
                            className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            <BarChart3 className="size-4" />
                        </button>
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
                                        ? 'border-transparent bg-secondary text-foreground hover:bg-secondary/70'
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
                        className="inline-flex size-8 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-30 transition-opacity"
                    >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />}
                    </button>
                </div>
            </div>
        </div>
    )
}
