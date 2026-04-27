import { isValidElement, useState, type JSX } from 'react'
import { Globe } from 'lucide-react'
import { FilePathCard } from './file-path-card'
import { MermaidRenderer } from '@/components/mermaid-renderer'

export function MarkdownPreOverride(props: JSX.IntrinsicElements['pre']) {
  const { children, ...rest } = props

  // Check if the child is a <code> with className "language-filepath"
  if (isValidElement(children)) {
    const childProps = children.props as { className?: string; children?: unknown }
    if (
      typeof childProps.className === 'string' &&
      childProps.className.includes('language-filepath')
    ) {
      const text = typeof childProps.children === 'string'
        ? childProps.children.trim()
        : ''
      if (text) {
        return <FilePathCard filePath={text} />
      }
    }
    if (
      typeof childProps.className === 'string' &&
      childProps.className.includes('language-mermaid')
    ) {
      const text = typeof childProps.children === 'string'
        ? childProps.children.trim()
        : ''
      if (text) {
        return <MermaidRenderer source={text} />
      }
    }
    if (
      typeof childProps.className === 'string' &&
      childProps.className.includes('language-html')
    ) {
      const text = typeof childProps.children === 'string'
        ? childProps.children.trim()
        : ''
      if (text) {
        return <HtmlBlock html={text} />
      }
    }
  }

  // Passthrough for all other code blocks - return children directly
  // so Streamdown's own rendering (syntax highlighting, etc.) is preserved
  return <pre {...rest}>{children}</pre>
}

function HtmlBlock({ html }: { html: string }) {
  const [showPreview, setShowPreview] = useState(false)

  const handleOpenInBrowser = async () => {
    const timestamp = Date.now()
    const tempPath = `knowledge/.tmp/artifact-${timestamp}.html`
    await window.ipc.invoke('workspace:writeFile', {
      path: tempPath,
      data: html,
      opts: { encoding: 'utf8', mkdirp: true },
    })
    const url = `http://localhost:3210/vault/workspace/${tempPath}`
    await window.ipc.invoke('browser:newTab', { url })
    window.dispatchEvent(new CustomEvent('browser:open'))
  }

  return (
    <div className="relative">
      <pre className="text-sm font-mono text-foreground whitespace-pre-wrap overflow-x-auto">
        <code className="language-html">{html}</code>
      </pre>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 bg-muted/30">
        <button
          type="button"
          onClick={handleOpenInBrowser}
          className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
        >
          <Globe className="size-3" />
          Open in browser
        </button>
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
        >
          {showPreview ? 'Hide preview' : 'Preview'}
        </button>
      </div>
      {showPreview && (
        <div className="border-t border-border bg-background">
          <iframe
            srcDoc={html}
            className="w-full border-0"
            style={{ minHeight: 200, maxHeight: 400 }}
            sandbox="allow-scripts"
            title="HTML preview"
          />
        </div>
      )}
    </div>
  )
}
