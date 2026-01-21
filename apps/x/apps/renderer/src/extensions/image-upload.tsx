import { mergeAttributes } from '@tiptap/react'
import { Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Loader2, ImageIcon } from 'lucide-react'

// Component for the upload placeholder
function ImageUploadPlaceholder({ node }: { node: { attrs: { progress?: number } } }) {
  const progress = node.attrs.progress || 0

  return (
    <NodeViewWrapper className="image-upload-placeholder">
      <div className="flex flex-col items-center justify-center gap-2 p-8 border-2 border-dashed border-border rounded-lg bg-muted/30">
        {progress < 100 ? (
          <>
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Uploading image...
            </span>
            {progress > 0 && (
              <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <ImageIcon className="size-8 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Processing...
            </span>
          </>
        )}
      </div>
    </NodeViewWrapper>
  )
}

// Extension for the upload placeholder node
export const ImageUploadPlaceholderExtension = Node.create({
  name: 'imageUploadPlaceholder',
  group: 'block',
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      id: {
        default: null,
      },
      progress: {
        default: 0,
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="image-upload-placeholder"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'image-upload-placeholder' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageUploadPlaceholder)
  },
})

// Helper to insert placeholder and handle upload
export function createImageUploadHandler(
  editor: Editor | null,
  uploadFn: (file: File) => Promise<string | null>
) {
  return async (file: File) => {
    if (!editor) return

    // Generate unique ID for this upload
    const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Insert placeholder at current position
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'imageUploadPlaceholder',
        attrs: { id: uploadId, progress: 0 },
      })
      .run()

    try {
      // Perform the upload
      const imageUrl = await uploadFn(file)

      if (imageUrl) {
        // Find and replace the placeholder with the actual image
        const { state } = editor
        let placeholderPos: number | null = null

        state.doc.descendants((node, pos) => {
          if (
            node.type.name === 'imageUploadPlaceholder' &&
            node.attrs.id === uploadId
          ) {
            placeholderPos = pos
            return false
          }
          return true
        })

        if (placeholderPos !== null) {
          editor
            .chain()
            .focus()
            .deleteRange({ from: placeholderPos, to: placeholderPos + 1 })
            .insertContentAt(placeholderPos, {
              type: 'image',
              attrs: { src: imageUrl },
            })
            .run()
        }
      } else {
        // Upload failed - remove placeholder
        removePlaceholder(editor, uploadId)
      }
    } catch (error) {
      console.error('Image upload failed:', error)
      removePlaceholder(editor, uploadId)
    }
  }
}

function removePlaceholder(
  editor: Editor | null,
  uploadId: string
) {
  if (!editor) return

  const { state } = editor
  let placeholderPos: number | null = null

  state.doc.descendants((node, pos) => {
    if (
      node.type.name === 'imageUploadPlaceholder' &&
      node.attrs.id === uploadId
    ) {
      placeholderPos = pos
      return false
    }
    return true
  })

  if (placeholderPos !== null) {
    editor
      .chain()
      .focus()
      .deleteRange({ from: placeholderPos, to: placeholderPos + 1 })
      .run()
  }
}
