import { useState, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  BoldIcon,
  ItalicIcon,
  StrikethroughIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  QuoteIcon,
  MinusIcon,
  LinkIcon,
  CodeSquareIcon,
  Undo2Icon,
  Redo2Icon,
  ExternalLinkIcon,
  Trash2Icon,
} from 'lucide-react'

interface EditorToolbarProps {
  editor: Editor | null
  onSelectionHighlight?: (range: { from: number; to: number } | null) => void
}

export function EditorToolbar({ editor, onSelectionHighlight }: EditorToolbarProps) {
  const [linkUrl, setLinkUrl] = useState('')
  const [isLinkPopoverOpen, setIsLinkPopoverOpen] = useState(false)

  const openLinkPopover = useCallback(() => {
    if (!editor) return
    const previousUrl = editor.getAttributes('link').href || ''
    setLinkUrl(previousUrl)

    // Highlight the current selection while popover is open
    const { from, to } = editor.state.selection
    if (from !== to && onSelectionHighlight) {
      onSelectionHighlight({ from, to })
    }

    setIsLinkPopoverOpen(true)
  }, [editor, onSelectionHighlight])

  const closeLinkPopover = useCallback(() => {
    setIsLinkPopoverOpen(false)
    setLinkUrl('')
    onSelectionHighlight?.(null)
  }, [onSelectionHighlight])

  const applyLink = useCallback(() => {
    if (!editor) return

    if (linkUrl === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      // Ensure URL has protocol
      let url = linkUrl.trim()
      if (url && !url.match(/^https?:\/\//i) && !url.startsWith('mailto:')) {
        url = 'https://' + url
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
    closeLinkPopover()
  }, [editor, linkUrl, closeLinkPopover])

  const removeLink = useCallback(() => {
    if (!editor) return
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    closeLinkPopover()
  }, [editor, closeLinkPopover])

  if (!editor) return null

  const isLinkActive = editor.isActive('link')

  return (
    <div className="editor-toolbar">
      {/* Undo / Redo */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Undo (Ctrl+Z)"
      >
        <Undo2Icon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo2Icon className="size-4" />
      </Button>

      <div className="separator" />

      {/* Text formatting */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleBold().run()}
        data-active={editor.isActive('bold') || undefined}
        className="data-[active]:bg-accent"
        title="Bold (Ctrl+B)"
      >
        <BoldIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        data-active={editor.isActive('italic') || undefined}
        className="data-[active]:bg-accent"
        title="Italic (Ctrl+I)"
      >
        <ItalicIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        data-active={editor.isActive('strike') || undefined}
        className="data-[active]:bg-accent"
        title="Strikethrough"
      >
        <StrikethroughIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleCode().run()}
        data-active={editor.isActive('code') || undefined}
        className="data-[active]:bg-accent"
        title="Inline Code"
      >
        <CodeIcon className="size-4" />
      </Button>

      <div className="separator" />

      {/* Headings */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        data-active={editor.isActive('heading', { level: 1 }) || undefined}
        className="data-[active]:bg-accent"
        title="Heading 1"
      >
        <Heading1Icon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        data-active={editor.isActive('heading', { level: 2 }) || undefined}
        className="data-[active]:bg-accent"
        title="Heading 2"
      >
        <Heading2Icon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        data-active={editor.isActive('heading', { level: 3 }) || undefined}
        className="data-[active]:bg-accent"
        title="Heading 3"
      >
        <Heading3Icon className="size-4" />
      </Button>

      <div className="separator" />

      {/* Lists */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        data-active={editor.isActive('bulletList') || undefined}
        className="data-[active]:bg-accent"
        title="Bullet List"
      >
        <ListIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        data-active={editor.isActive('orderedList') || undefined}
        className="data-[active]:bg-accent"
        title="Ordered List"
      >
        <ListOrderedIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        data-active={editor.isActive('taskList') || undefined}
        className="data-[active]:bg-accent"
        title="Task List"
      >
        <ListTodoIcon className="size-4" />
      </Button>

      <div className="separator" />

      {/* Blocks */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        data-active={editor.isActive('blockquote') || undefined}
        className="data-[active]:bg-accent"
        title="Blockquote"
      >
        <QuoteIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        data-active={editor.isActive('codeBlock') || undefined}
        className="data-[active]:bg-accent"
        title="Code Block"
      >
        <CodeSquareIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal Rule"
      >
        <MinusIcon className="size-4" />
      </Button>

      {/* Link with popover */}
      <Popover
        open={isLinkPopoverOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeLinkPopover()
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={openLinkPopover}
            data-active={isLinkActive || undefined}
            className="data-[active]:bg-accent"
            title="Link"
          >
            <LinkIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-3" align="start">
          <div className="flex flex-col gap-3">
            <div className="text-sm font-medium">
              {isLinkActive ? 'Edit Link' : 'Add Link'}
            </div>
            <Input
              placeholder="https://example.com"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  applyLink()
                }
                if (e.key === 'Escape') {
                  setIsLinkPopoverOpen(false)
                }
              }}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={applyLink} className="flex-1">
                {isLinkActive ? 'Update' : 'Apply'}
              </Button>
              {isLinkActive && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      window.open(linkUrl, '_blank')
                    }}
                    title="Open link"
                  >
                    <ExternalLinkIcon className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={removeLink}
                    title="Remove link"
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
