import { useEditor, EditorContent, Extension, Editor } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { ImageUploadPlaceholderExtension, createImageUploadHandler } from '@/extensions/image-upload'
import { Markdown } from 'tiptap-markdown'
import { useEffect, useCallback, useMemo, useRef, useState } from 'react'

// Zero-width space used as invisible marker for blank lines
const BLANK_LINE_MARKER = '\u200B'

// Pre-process markdown to preserve blank lines before parsing
function preprocessMarkdown(markdown: string): string {
  // Convert sequences of 3+ newlines to paragraphs with zero-width space
  // - 2 newlines = normal paragraph break (0 empty paragraphs)
  // - 3 newlines = 1 blank line = 1 empty paragraph
  // - 4 newlines = 2 blank lines = 2 empty paragraphs
  // Formula: emptyParagraphs = totalNewlines - 2
  return markdown.replace(/\n{3,}/g, (match) => {
    const totalNewlines = match.length
    const emptyParagraphs = totalNewlines - 2
    let result = '\n\n'
    for (let i = 0; i < emptyParagraphs; i++) {
      result += BLANK_LINE_MARKER + '\n\n'
    }
    return result
  })
}

// Post-process to clean up any zero-width spaces in the output
function postprocessMarkdown(markdown: string): string {
  // Remove lines that contain only the zero-width space marker
  return markdown.split('\n').map(line => {
    if (line === BLANK_LINE_MARKER || line.trim() === BLANK_LINE_MARKER) {
      return ''
    }
    // Also remove zero-width spaces from other content
    return line.replace(new RegExp(BLANK_LINE_MARKER, 'g'), '')
  }).join('\n')
}

// Custom function to get markdown that preserves empty paragraphs as blank lines
function getMarkdownWithBlankLines(editor: Editor): string {
  const json = editor.getJSON()
  if (!json.content) return ''

  const blocks: string[] = []

  // Helper to convert a node to markdown text
  const nodeToText = (node: { type?: string; content?: Array<{ type?: string; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }>; attrs?: Record<string, unknown> }): string => {
    if (!node.content) return ''
    return node.content.map(child => {
      if (child.type === 'text') {
        let text = child.text || ''
        // Apply marks (bold, italic, etc.)
        if (child.marks) {
          for (const mark of child.marks) {
            if (mark.type === 'bold') text = `**${text}**`
            else if (mark.type === 'italic') text = `*${text}*`
            else if (mark.type === 'code') text = `\`${text}\``
            else if (mark.type === 'link' && mark.attrs?.href) text = `[${text}](${mark.attrs.href})`
          }
        }
        return text
      } else if (child.type === 'hardBreak') {
        return '\n'
      }
      return ''
    }).join('')
  }

  for (const node of json.content) {
    if (node.type === 'paragraph') {
      const text = nodeToText(node)
      // If the paragraph contains only the blank line marker or is empty, it's a blank line
      if (!text || text === BLANK_LINE_MARKER || text.trim() === BLANK_LINE_MARKER) {
        // Push empty string to represent blank line - will add extra newline when joining
        blocks.push('')
      } else {
        blocks.push(text)
      }
    } else if (node.type === 'heading') {
      const level = (node.attrs?.level as number) || 1
      const text = nodeToText(node)
      blocks.push('#'.repeat(level) + ' ' + text)
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      // Handle lists - all items are part of one block
      const listLines: string[] = []
      const listItems = (node.content || []) as Array<{ content?: Array<unknown>; attrs?: Record<string, unknown> }>
      listItems.forEach((item, index) => {
        const prefix = node.type === 'orderedList' ? `${index + 1}. ` : '- '
        const itemContent = (item.content || []) as Array<{ type?: string; content?: Array<{ type?: string; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }>; attrs?: Record<string, unknown> }>
        itemContent.forEach((para: { type?: string; content?: Array<{ type?: string; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }>; attrs?: Record<string, unknown> }, paraIndex: number) => {
          const text = nodeToText(para)
          if (paraIndex === 0) {
            listLines.push(prefix + text)
          } else {
            listLines.push('  ' + text)
          }
        })
      })
      blocks.push(listLines.join('\n'))
    } else if (node.type === 'taskList') {
      const listLines: string[] = []
      const listItems = (node.content || []) as Array<{ content?: Array<unknown>; attrs?: Record<string, unknown> }>
      listItems.forEach(item => {
        const checked = item.attrs?.checked ? 'x' : ' '
        const itemContent = (item.content || []) as Array<{ type?: string; content?: Array<{ type?: string; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }>; attrs?: Record<string, unknown> }>
        itemContent.forEach((para: { type?: string; content?: Array<{ type?: string; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }>; attrs?: Record<string, unknown> }, paraIndex: number) => {
          const text = nodeToText(para)
          if (paraIndex === 0) {
            listLines.push(`- [${checked}] ${text}`)
          } else {
            listLines.push('  ' + text)
          }
        })
      })
      blocks.push(listLines.join('\n'))
    } else if (node.type === 'codeBlock') {
      const lang = (node.attrs?.language as string) || ''
      blocks.push('```' + lang + '\n' + nodeToText(node) + '\n```')
    } else if (node.type === 'blockquote') {
      const content = node.content || []
      const quoteLines = content.map(para => '> ' + nodeToText(para))
      blocks.push(quoteLines.join('\n'))
    } else if (node.type === 'horizontalRule') {
      blocks.push('---')
    } else if (node.type === 'wikiLink') {
      const path = (node.attrs?.path as string) || ''
      blocks.push(`[[${path}]]`)
    } else if (node.type === 'image') {
      const src = (node.attrs?.src as string) || ''
      const alt = (node.attrs?.alt as string) || ''
      blocks.push(`![${alt}](${src})`)
    }
  }

  // Custom join: content blocks get \n\n before them, empty blocks add \n each
  // This produces: 1 empty paragraph = 3 newlines (1 blank line on disk)
  if (blocks.length === 0) return ''

  let result = ''

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const isContent = block !== ''

    if (i === 0) {
      result = block
    } else if (isContent) {
      // Content block: add \n\n before it (standard paragraph break)
      result += '\n\n' + block
    } else {
      // Empty block: just add \n (one extra newline for blank line)
      result += '\n'
    }
  }

  return result
}
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
  onImageUpload?: (file: File) => Promise<string | null>
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

const TabIndentExtension = Extension.create({
  name: 'tabIndent',
  addKeyboardShortcuts() {
    const indentText = '  '
    return {
      Tab: () => {
        // Always handle Tab so focus never leaves the editor.
        // First try list indentation; otherwise insert spaces.
        if (this.editor.can().sinkListItem('taskItem')) {
          void this.editor.commands.sinkListItem('taskItem')
          return true
        }
        if (this.editor.can().sinkListItem('listItem')) {
          void this.editor.commands.sinkListItem('listItem')
          return true
        }
        void this.editor.commands.insertContent(indentText)
        return true
      },
      'Shift-Tab': () => {
        // Always handle Shift+Tab so focus never leaves the editor.
        if (this.editor.can().liftListItem('taskItem')) {
          void this.editor.commands.liftListItem('taskItem')
          return true
        }
        if (this.editor.can().liftListItem('listItem')) {
          void this.editor.commands.liftListItem('listItem')
          return true
        }
        return true
      },
    }
  },
})

export function MarkdownEditor({
  content,
  onChange,
  placeholder = 'Start writing...',
  wikiLinks,
  onImageUpload,
}: MarkdownEditorProps) {
  const isInternalUpdate = useRef(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [activeWikiLink, setActiveWikiLink] = useState<WikiLinkMatch | null>(null)
  const [anchorPosition, setAnchorPosition] = useState<{ left: number; top: number } | null>(null)
  const [selectionHighlight, setSelectionHighlight] = useState<SelectionHighlightRange>(null)
  const selectionHighlightRef = useRef<SelectionHighlightRange>(null)
  const [wikiCommandValue, setWikiCommandValue] = useState<string>('')
  const wikiKeyStateRef = useRef<{ open: boolean; options: string[]; value: string }>({ open: false, options: [], value: '' })
  const handleSelectWikiLinkRef = useRef<(path: string) => void>(() => {})

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
      Image.configure({
        inline: false,
        allowBase64: true,
        HTMLAttributes: {
          class: 'editor-image',
        },
      }),
      ImageUploadPlaceholderExtension,
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
        html: true,
        breaks: true,
        tightLists: false,
        transformCopiedText: true,
        transformPastedText: true,
      }),
      selectionHighlightExtension,
      TabIndentExtension,
    ],
    content: '',
    onUpdate: ({ editor }) => {
      if (isInternalUpdate.current) return
      let markdown = getMarkdownWithBlankLines(editor)
      // Post-process to clean up any markers and ensure blank lines are preserved
      markdown = postprocessMarkdown(markdown)
      onChange(markdown)
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none',
      },
      handleKeyDown: (_view, event) => {
        const state = wikiKeyStateRef.current
        if (state.open) {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setActiveWikiLink(null)
            setAnchorPosition(null)
            setWikiCommandValue('')
            return true
          }

          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (state.options.length === 0) return true
            event.preventDefault()
            event.stopPropagation()
            const currentIndex = Math.max(0, state.options.indexOf(state.value))
            const delta = event.key === 'ArrowDown' ? 1 : -1
            const nextIndex = (currentIndex + delta + state.options.length) % state.options.length
            setWikiCommandValue(state.options[nextIndex])
            return true
          }

          if (event.key === 'Enter' || event.key === 'Tab') {
            if (state.options.length === 0) return true
            event.preventDefault()
            event.stopPropagation()
            const selected = state.options.includes(state.value) ? state.value : state.options[0]
            handleSelectWikiLinkRef.current(selected)
            return true
          }
        }

        return false
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
      const currentContent = getMarkdownWithBlankLines(editor)
      // Normalize for comparison (trim trailing whitespace from lines)
      const normalizeForCompare = (s: string) => s.split('\n').map(line => line.trimEnd()).join('\n').trim()
      if (normalizeForCompare(currentContent) !== normalizeForCompare(content)) {
        isInternalUpdate.current = true
        // Pre-process to preserve blank lines
        const preprocessed = preprocessMarkdown(content)
        editor.commands.setContent(preprocessed)
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

  useEffect(() => {
    handleSelectWikiLinkRef.current = handleSelectWikiLink
  }, [handleSelectWikiLink])

  const handleScroll = useCallback(() => {
    updateWikiLinkState()
  }, [updateWikiLinkState])

  const showWikiPopover = Boolean(wikiLinks && activeWikiLink && anchorPosition)
  const wikiOptions = useMemo(() => {
    if (!showWikiPopover) return []
    const options: string[] = []
    if (canCreate) options.push(createCandidate)
    options.push(...visibleFiles)
    return options
  }, [showWikiPopover, canCreate, createCandidate, visibleFiles])

  useEffect(() => {
    wikiKeyStateRef.current = { open: showWikiPopover, options: wikiOptions, value: wikiCommandValue }
  }, [showWikiPopover, wikiOptions, wikiCommandValue])

  // Keep cmdk selection in sync with available options
  useEffect(() => {
    if (!showWikiPopover) {
      setWikiCommandValue('')
      return
    }
    if (wikiOptions.length === 0) {
      setWikiCommandValue('')
      return
    }
    setWikiCommandValue((prev) => (wikiOptions.includes(prev) ? prev : wikiOptions[0]))
  }, [showWikiPopover, wikiOptions])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 's' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      // The parent component handles saving via onChange
    }
  }, [])

  // Create image upload handler that shows placeholder
  const handleImageUploadWithPlaceholder = useMemo(() => {
    if (!editor || !onImageUpload) return undefined
    return createImageUploadHandler(editor, onImageUpload)
  }, [editor, onImageUpload])

  return (
    <div className="tiptap-editor" onKeyDown={handleKeyDown}>
      <EditorToolbar
        editor={editor}
        onSelectionHighlight={setSelectionHighlight}
        onImageUpload={handleImageUploadWithPlaceholder}
      />
      <div className="editor-content-wrapper" ref={wrapperRef} onScroll={handleScroll}>
        <EditorContent editor={editor} />
        {wikiLinks ? (
          <Popover
            open={showWikiPopover}
            onOpenChange={(open) => {
              if (!open) {
                setActiveWikiLink(null)
                setAnchorPosition(null)
                setWikiCommandValue('')
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
              <Command shouldFilter={false} value={wikiCommandValue} onValueChange={setWikiCommandValue}>
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
