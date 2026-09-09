import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import type { EditorView } from '@tiptap/pm/view'
import { caretContext, composerExtensions, composerMarkdown } from '@/components/spaces/composer-editor'
import { RichFormattingToolbar } from '@/components/spaces/composer-toolbar'
import { MentionMenu, useMentionAutocomplete } from '@/components/spaces/mention-autocomplete'
import { useSpaceProfiles } from '@/components/spaces/member-text'
import { mentionEndingAtCaret } from '@/lib/spaces-presentation'
import '@/styles/space-composer.css'

/**
 * The inline message editor — the composer's surface (same TipTap nodes,
 * markdown input rules, toolbar and @mention popup) minus the send-only
 * machinery (attachments, slash commands, drafts, scheduling). Enter saves,
 * Shift+Enter breaks a line, Escape cancels; members come from the space's
 * profiles context. The host owns the draft string (onChange fires with the
 * doc's markdown on every edit) and renders its own Save/Cancel row; extra
 * rows inside the bordered box (image thumbnails) ride in as children.
 */
export function MessageEditBox({ initial, onChange, onSave, onCancel, children }: {
    /** The starting markdown — mentions already resolved to display names. */
    initial: string
    /**
     * Fires with the doc's markdown on every edit, and once on mount with the
     * editor's own serialization of `initial` — TipTap normalizes markdown as
     * it parses, so that first value is the baseline an untouched draft
     * compares equal to.
     */
    onChange: (markdown: string) => void
    onSave: () => void
    onCancel: () => void
    children?: ReactNode
}) {
    const { byId, selfId } = useSpaceProfiles()
    const members = useMemo(() => [...byId.values()], [byId])
    // The menu anchors to this box; state (not a ref) so it re-renders once
    // the node exists and the menu can measure against it.
    const [box, setBox] = useState<HTMLDivElement | null>(null)
    const keydownRef = useRef<(view: EditorView, event: KeyboardEvent) => boolean>(() => false)
    const onChangeRef = useRef(onChange)
    const editor = useEditor({
        extensions: composerExtensions(() => 'Add a message'),
        content: initial,
        autofocus: 'end',
        editorProps: {
            handleKeyDown: (view, event) => keydownRef.current(view, event),
        },
        onUpdate: ({ editor: ed }) => onChangeRef.current(composerMarkdown(ed)),
    })
    const mention = useMentionAutocomplete(editor, { members, ...(selfId ? { selfMemberId: selfId } : {}) })

    const handleKeyDown = (view: EditorView, e: KeyboardEvent): boolean => {
        if (mention.onKeyDown(e)) return true
        if (e.key === 'Escape') {
            onCancel()
            return true
        }
        if (e.key === 'Backspace' && editor) {
            // A mention deletes as one unit (the Discord behavior, same as
            // the composer); caretContext bows out for selections and code.
            const ctx = caretContext(editor)
            const start = ctx ? mentionEndingAtCaret(ctx.text, members.map((m) => m.displayName)) : null
            if (ctx && start !== null) {
                return editor.chain().focus().deleteRange({ from: ctx.from - (ctx.text.length - start), to: ctx.from }).run()
            }
            return false
        }
        if (e.key === 'Enter') {
            // ⌘Enter saves from anywhere, even inside a code fence — the
            // composer's ⌘Enter-always-sends rule.
            if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
                onSave()
                return true
            }
            if (!e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !view.composing) {
                // Inside a code fence Enter breaks the line (the composer's
                // posture); everywhere else it saves.
                if (view.state.selection.$from.parent.type.name === 'codeBlock') return false
                onSave()
                return true
            }
        }
        return false
    }

    // Callbacks read through refs, re-pointed after every render, so the
    // create-once editor always sees current state (the composer's pattern).
    useEffect(() => {
        keydownRef.current = handleKeyDown
        onChangeRef.current = onChange
    })

    // The baseline, once the editor exists: what `initial` serializes back to
    // untouched. onUpdate never fires for the initial content.
    useEffect(() => {
        if (editor) onChangeRef.current(composerMarkdown(editor))
    }, [editor])

    return (
        <div ref={setBox} className="rounded-2xl border border-border bg-background">
            {mention.show && <MentionMenu anchor={box} candidates={mention.candidates} index={mention.index} onPick={mention.pick} />}
            <RichFormattingToolbar editor={editor} className="px-2 pt-1.5" />
            <EditorContent editor={editor} className="space-composer space-composer-edit" />
            {children}
        </div>
    )
}
