import { useEditor, EditorContent, Extension } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { EditorToolbar } from './editor-toolbar'
import { WikiLink } from '@/extensions/wiki-link'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandItem, CommandList } from '@/components/ui/command'
import { ensureMarkdownExtension, normalizeWikiPath, wikiLabel } from '@/lib/wiki-links'
import '@/styles/editor.css'

type WikiLinkConfig = {
  files: string[]
  recent: string[]
  onOpen: (path: string) => void
  onCreate: (path: string) => void | Promise<void>
}

interface MarkdownEditorProps {
  content: string
  onChange: (markdown: string) => void
  placeholder?: string
  wikiLinks?: WikiLinkConfig
}

type WikiLinkMatch = {
  range: { from: number; to: number }
  query: string
}

type SelectionHighlightRange = { from: number; to: number } | null

// Plugin key for the selection highlight
const selectionHighlightKey = new PluginKey('selectionHighlight')

// Create the selection highlight extension
const createSelectionHighlightExtension = (getRange: () => SelectionHighlightRange) => {
  return Extension.create({
    name: 'selectionHighlight',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: selectionHighlightKey,
          props: {
            decorations(state) {
              const range = getRange()
              if (!range) return DecorationSet.empty

              const { from, to } = range
              if (from >= to || from < 0 || to > state.doc.content.size) {
                return DecorationSet.empty
              }

              const decoration = Decoration.inline(from, to, {
                class: 'selection-highlight',
              })
              return DecorationSet.create(state.doc, [decoration])
            },
          },
        }),
      ]
    },
  })
}

export function MarkdownEditor({
  content,
  onChange,
  placeholder = 'Start writing...',
  wikiLinks,
}: MarkdownEditorProps) {
  const isInternalUpdate = useRef(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [activeWikiLink, setActiveWikiLink] = useState<WikiLinkMatch | null>(null)
  const [anchorPosition, setAnchorPosition] = useState<{ left: number; top: number } | null>(null)
  const [selectionHighlight, setSelectionHighlight] = useState<SelectionHighlightRange>(null)
  const selectionHighlightRef = useRef<SelectionHighlightRange>(null)

  // Keep ref in sync with state for the plugin to access
  selectionHighlightRef.current = selectionHighlight

  // Memoize the selection highlight extension
  const selectionHighlightExtension = useMemo(
    () => createSelectionHighlightExtension(() => selectionHighlightRef.current),
    []
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      WikiLink.configure({
        onCreate: wikiLinks?.onCreate
          ? (path) => {
              void wikiLinks.onCreate(path)
            }
          : undefined,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Placeholder.configure({
        placeholder,
      }),
      Markdown.configure({
        html: false,
        breaks: true,
        transformCopiedText: true,
        transformPastedText: true,
      }),
      selectionHighlightExtension,
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (isInternalUpdate.current) return
      const storage = editor.storage as unknown as Record<string, { getMarkdown?: () => string }>
      const markdown = storage.markdown?.getMarkdown?.() ?? ''
      onChange(markdown)
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none',
      },
      handleClickOn: (_view, _pos, node, _nodePos, event) => {
        if (node.type.name === 'wikiLink') {
          event.preventDefault()
          wikiLinks?.onOpen?.(node.attrs.path)
          return true
        }
        return false
      },
    },
  })

  const orderedFiles = useMemo(() => {
    if (!wikiLinks) return []
    const seen = new Set<string>()
    const ordered: string[] = []

    const addPath = (path: string) => {
      const normalized = normalizeWikiPath(path)
      if (!normalized || seen.has(normalized)) return
      seen.add(normalized)
      ordered.push(normalized)
    }

    wikiLinks.recent.forEach(addPath)
    wikiLinks.files.forEach(addPath)

    return ordered
  }, [wikiLinks])

  const updateWikiLinkState = useCallback(() => {
    if (!editor || !wikiLinks) return
    const { selection } = editor.state
    if (!selection.empty) {
      setActiveWikiLink(null)
      setAnchorPosition(null)
      return
    }

    const { $from } = selection
    if ($from.parent.type.spec.code) {
      setActiveWikiLink(null)
      setAnchorPosition(null)
      return
    }
    if ($from.marks().some((mark) => mark.type.spec.code)) {
      setActiveWikiLink(null)
      setAnchorPosition(null)
      return
    }

    const text = $from.parent.textBetween(0, $from.parent.content.size, '\n', '\n')
    const textBefore = text.slice(0, $from.parentOffset)
    const triggerIndex = textBefore.lastIndexOf('[[')
    if (triggerIndex === -1 || textBefore.indexOf(']]', triggerIndex) !== -1) {
      setActiveWikiLink(null)
      setAnchorPosition(null)
      return
    }

    const matchText = textBefore.slice(triggerIndex)
    const query = matchText.slice(2)
    const range = { from: selection.from - matchText.length, to: selection.from }
    setActiveWikiLink({ range, query })

    const wrapper = wrapperRef.current
    if (!wrapper) {
      setAnchorPosition(null)
      return
    }

    const coords = editor.view.coordsAtPos(selection.from)
    const wrapperRect = wrapper.getBoundingClientRect()
    setAnchorPosition({
      left: coords.left - wrapperRect.left,
      top: coords.bottom - wrapperRect.top,
    })
  }, [editor, wikiLinks])

  useEffect(() => {
    if (!editor || !wikiLinks) return
    editor.on('update', updateWikiLinkState)
    editor.on('selectionUpdate', updateWikiLinkState)
    return () => {
      editor.off('update', updateWikiLinkState)
      editor.off('selectionUpdate', updateWikiLinkState)
    }
  }, [editor, wikiLinks, updateWikiLinkState])

  // Update editor content when prop changes (e.g., file selection changes)
  useEffect(() => {
    if (editor && content !== undefined) {
      const storage = editor.storage as unknown as Record<string, { getMarkdown?: () => string }>
      const currentContent = storage.markdown?.getMarkdown?.() ?? ''
      if (currentContent !== content) {
        isInternalUpdate.current = true
        editor.commands.setContent(content)
        isInternalUpdate.current = false
      }
    }
  }, [editor, content])

  // Force re-render decorations when selection highlight changes
  useEffect(() => {
    if (editor) {
      // Trigger a transaction to force decoration re-render
      editor.view.dispatch(editor.state.tr)
    }
  }, [editor, selectionHighlight])

  const normalizedQuery = normalizeWikiPath(activeWikiLink?.query ?? '').toLowerCase()
  const filteredFiles = useMemo(() => {
    if (!activeWikiLink) return []
    if (!normalizedQuery) return orderedFiles
    return orderedFiles.filter((path) => path.toLowerCase().includes(normalizedQuery))
  }, [activeWikiLink, normalizedQuery, orderedFiles])

  const visibleFiles = filteredFiles.slice(0, 12)
  const rawCreateCandidate = activeWikiLink ? normalizeWikiPath(activeWikiLink.query) : ''
  const createCandidate = rawCreateCandidate && !rawCreateCandidate.endsWith('/')
    ? ensureMarkdownExtension(rawCreateCandidate)
    : ''
  const canCreate = Boolean(
    createCandidate
      && !orderedFiles.some((path) => path.toLowerCase() === createCandidate.toLowerCase())
  )

  const handleSelectWikiLink = useCallback((path: string) => {
    if (!editor || !activeWikiLink) return
    const normalized = normalizeWikiPath(path)
    if (!normalized) return
    const finalPath = ensureMarkdownExtension(normalized)
    void wikiLinks?.onCreate?.(finalPath)

    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: activeWikiLink.range.from, to: activeWikiLink.range.to },
        { type: 'wikiLink', attrs: { path: finalPath } }
      )
      .run()

    setActiveWikiLink(null)
    setAnchorPosition(null)
  }, [editor, activeWikiLink, wikiLinks])

  const handleScroll = useCallback(() => {
    updateWikiLinkState()
  }, [updateWikiLinkState])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      // The parent component handles saving via onChange
    }
  }, [])

  const showWikiPopover = Boolean(wikiLinks && activeWikiLink && anchorPosition)

  return (
    <div className="tiptap-editor" onKeyDown={handleKeyDown}>
      <EditorToolbar editor={editor} onSelectionHighlight={setSelectionHighlight} />
      <div className="editor-content-wrapper" ref={wrapperRef} onScroll={handleScroll}>
        <EditorContent editor={editor} />
        {wikiLinks ? (
          <Popover
            open={showWikiPopover}
            onOpenChange={(open) => {
              if (!open) {
                setActiveWikiLink(null)
                setAnchorPosition(null)
              }
            }}
          >
            <PopoverAnchor asChild>
              <span
                className="wiki-link-anchor"
                style={
                  anchorPosition
                    ? { left: anchorPosition.left, top: anchorPosition.top }
                    : undefined
                }
              />
            </PopoverAnchor>
            <PopoverContent
              className="w-72 p-1"
              align="start"
              side="bottom"
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <Command shouldFilter={false}>
                <CommandList>
                  {canCreate ? (
                    <CommandItem
                      value={createCandidate}
                      onSelect={() => handleSelectWikiLink(createCandidate)}
                    >
                      Create "{wikiLabel(createCandidate) || createCandidate}"
                    </CommandItem>
                  ) : null}
                  {visibleFiles.map((path) => (
                    <CommandItem
                      key={path}
                      value={path}
                      onSelect={() => handleSelectWikiLink(path)}
                    >
                      {wikiLabel(path)}
                    </CommandItem>
                  ))}
                  {visibleFiles.length === 0 && !canCreate ? (
                    <CommandEmpty>No matches found.</CommandEmpty>
                  ) : null}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  )
}
