import type { Editor } from '@tiptap/react'
import { Button } from '@/components/ui/button'
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
  QuoteIcon,
  MinusIcon,
  LinkIcon,
  CodeSquareIcon,
} from 'lucide-react'

interface EditorToolbarProps {
  editor: Editor | null
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  if (!editor) return null

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('URL', previousUrl)

    if (url === null) return

    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }

    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  return (
    <div className="editor-toolbar">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleBold().run()}
        data-active={editor.isActive('bold') || undefined}
        className="data-[active]:bg-accent"
        title="Bold"
      >
        <BoldIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        data-active={editor.isActive('italic') || undefined}
        className="data-[active]:bg-accent"
        title="Italic"
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

      <div className="separator" />

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
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={setLink}
        data-active={editor.isActive('link') || undefined}
        className="data-[active]:bg-accent"
        title="Link"
      >
        <LinkIcon className="size-4" />
      </Button>
    </div>
  )
}
