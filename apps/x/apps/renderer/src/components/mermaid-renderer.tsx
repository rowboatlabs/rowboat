import { useEffect, useId, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { useTheme } from '@/contexts/theme-context'

let lastTheme: string | null = null

function ensureInit(theme: 'default' | 'dark') {
  if (lastTheme === theme) return
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
  })
  lastTheme = theme
}

interface MermaidRendererProps {
  source: string
  className?: string
}

export function MermaidRenderer({ source, className }: MermaidRendererProps) {
  const { resolvedTheme } = useTheme()
  const id = useId().replace(/:/g, '-')
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!source.trim()) {
      setSvg(null)
      setError(null)
      return
    }

    let cancelled = false
    const mermaidTheme = resolvedTheme === 'dark' ? 'dark' : 'default'
    ensureInit(mermaidTheme)

    mermaid
      .render(`mermaid-${id}`, source.trim())
      .then(({ svg: renderedSvg }) => {
        if (!cancelled) {
          setSvg(renderedSvg)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSvg(null)
          setError(err instanceof Error ? err.message : 'Failed to render diagram')
        }
      })

    return () => {
      cancelled = true
    }
  }, [source, resolvedTheme, id])

  if (error) {
    return (
      <div className={className}>
        <div style={{ color: 'var(--destructive, #ef4444)', fontSize: 12, marginBottom: 4 }}>
          Invalid mermaid syntax
        </div>
        <pre style={{ fontSize: 12, opacity: 0.7, whiteSpace: 'pre-wrap', margin: 0 }}>
          <code>{source}</code>
        </pre>
      </div>
    )
  }

  if (!svg) {
    return (
      <div className={className} style={{ fontSize: 13, opacity: 0.5 }}>
        Rendering diagram...
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={className}
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{ lineHeight: 0 }}
    />
  )
}
