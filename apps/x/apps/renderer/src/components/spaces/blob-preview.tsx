import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { DocumentFileViewer } from '@/components/document-file-viewer'
import { FileViewerSourceContext } from '@/components/file-viewer-source'
import { createSpaceAttachmentSource } from '@/lib/space-attachment-source'
import { getViewerType } from '@/lib/file-types'

/** Preview the original attachment, independently of any entry in space files. */
export function BlobPreview({ src, name }: { src: string; name: string }) {
    const source = useMemo(() => createSpaceAttachmentSource(src, name), [src, name])
    if (getViewerType(name)) return (
        <FileViewerSourceContext.Provider value={source}>
            <div className="h-full min-h-0 flex-1 overflow-hidden"><DocumentFileViewer key={src} path={name} /></div>
        </FileViewerSourceContext.Provider>
    )
    return <TextAttachmentPreview src={src} />
}

function TextAttachmentPreview({ src }: { src: string }) {
    const [content, setContent] = useState<{ text?: string; truncated: boolean } | null>(null)
    const [error, setError] = useState(false)
    useEffect(() => {
        const controller = new AbortController()
        setContent(null)
        setError(false)
        void (async () => {
            try {
                const response = await fetch(src, { signal: controller.signal })
                if (!response.ok) throw new Error('Could not load attachment')
                const blob = await response.blob()
                const mime = blob.type.split(';')[0] ?? ''
                const isText = mime.startsWith('text/') || ['application/json', 'application/xml', 'application/javascript'].includes(mime)
                const text = isText ? await blob.slice(0, 1_000_000).text() : undefined
                if (controller.signal.aborted) return
                setContent({ text, truncated: isText && blob.size > 1_000_000 })
            } catch {
                if (!controller.signal.aborted) setError(true)
            }
        })()
        return () => controller.abort()
    }, [src])
    if (error) return <p className="p-6 text-sm text-muted-foreground">Could not load this preview. Close and reopen to try again, or download the file.</p>
    if (!content) return <div role="status" className="flex items-center gap-2 p-6 text-sm"><Loader2 className="size-4 animate-spin" /> Loading preview…</div>
    if (content.text !== undefined) return <div>{content.truncated && <p className="px-4 text-xs text-muted-foreground">Showing the first 1 MB. Download to read the full file.</p>}<pre className="overflow-auto whitespace-pre-wrap break-words p-4 text-xs">{content.text}</pre></div>
    return <p className="p-6 text-sm text-muted-foreground">Preview isn’t available for this file type. Download it to open it on your device.</p>
}
