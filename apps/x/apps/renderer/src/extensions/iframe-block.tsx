import { mergeAttributes, Node } from '@tiptap/react'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { ExternalLink, Globe, X } from 'lucide-react'
import { blocks } from '@x/shared'
import { useEffect, useRef, useState } from 'react'

const IFRAME_HEIGHT_MESSAGE = 'rowboat:iframe-height'
const IFRAME_HEIGHT_CACHE_PREFIX = 'rowboat:iframe-height:'
const DEFAULT_IFRAME_HEIGHT = 560
const MIN_IFRAME_HEIGHT = 240
const HEIGHT_UPDATE_THRESHOLD = 4
const AUTO_RESIZE_SETTLE_MS = 160
const LOAD_FALLBACK_READY_MS = 180
const DEFAULT_IFRAME_ALLOW = [
  'accelerometer',
  'autoplay',
  'camera',
  'clipboard-read',
  'clipboard-write',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'geolocation',
  'microphone',
].join('; ')

function getIframeMeta(url: string): { host: string; path: string } | null {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.host,
      path: parsed.pathname === '/' ? '' : parsed.pathname,
    }
  } catch {
    return null
  }
}

function getIframeHeightCacheKey(url: string): string {
  return `${IFRAME_HEIGHT_CACHE_PREFIX}${url}`
}

function readCachedIframeHeight(url: string, fallbackHeight: number): number {
  try {
    const raw = window.localStorage.getItem(getIframeHeightCacheKey(url))
    if (!raw) return fallbackHeight
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) return fallbackHeight
    return Math.max(MIN_IFRAME_HEIGHT, parsed)
  } catch {
    return fallbackHeight
  }
}

function writeCachedIframeHeight(url: string, height: number): void {
  try {
    window.localStorage.setItem(getIframeHeightCacheKey(url), String(height))
  } catch {
    // ignore storage failures
  }
}

function parseIframeHeightMessage(event: MessageEvent): { height: number } | null {
  const data = event.data
  if (!data || typeof data !== 'object') return null

  const candidate = data as { type?: unknown; height?: unknown }
  if (candidate.type !== IFRAME_HEIGHT_MESSAGE) return null
  if (typeof candidate.height !== 'number' || !Number.isFinite(candidate.height)) return null

  return {
    height: Math.max(MIN_IFRAME_HEIGHT, Math.ceil(candidate.height)),
  }
}

function IframeBlockView({ node, deleteNode }: { node: { attrs: Record<string, unknown> }; deleteNode: () => void }) {
  const raw = node.attrs.data as string
  let config: blocks.IframeBlock | null = null

  try {
    config = blocks.IframeBlockSchema.parse(JSON.parse(raw))
  } catch {
    // fallback below
  }

  if (!config) {
    return (
      <NodeViewWrapper className="iframe-block-wrapper" data-type="iframe-block">
        <div className="iframe-block-card iframe-block-error">
          <Globe size={16} />
          <span>Invalid iframe block</span>
        </div>
      </NodeViewWrapper>
    )
  }

  const meta = getIframeMeta(config.url)
  const title = config.title || meta?.host || 'Embedded page'
  const allow = config.allow || DEFAULT_IFRAME_ALLOW
  const initialHeight = config.height ?? DEFAULT_IFRAME_HEIGHT
  const [frameHeight, setFrameHeight] = useState(() => readCachedIframeHeight(config.url, initialHeight))
  const [frameReady, setFrameReady] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const loadFallbackTimerRef = useRef<number | null>(null)
  const autoResizeReadyTimerRef = useRef<number | null>(null)
  const frameReadyRef = useRef(false)

  useEffect(() => {
    setFrameHeight(readCachedIframeHeight(config.url, initialHeight))
    setFrameReady(false)
    frameReadyRef.current = false
    if (loadFallbackTimerRef.current !== null) {
      window.clearTimeout(loadFallbackTimerRef.current)
      loadFallbackTimerRef.current = null
    }
    if (autoResizeReadyTimerRef.current !== null) {
      window.clearTimeout(autoResizeReadyTimerRef.current)
      autoResizeReadyTimerRef.current = null
    }
  }, [config.url, initialHeight, raw])

  useEffect(() => {
    frameReadyRef.current = frameReady
  }, [frameReady])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const iframeWindow = iframeRef.current?.contentWindow
      if (!iframeWindow || event.source !== iframeWindow) return

      const message = parseIframeHeightMessage(event)
      if (!message) return

      if (loadFallbackTimerRef.current !== null) {
        window.clearTimeout(loadFallbackTimerRef.current)
        loadFallbackTimerRef.current = null
      }
      if (autoResizeReadyTimerRef.current !== null) {
        window.clearTimeout(autoResizeReadyTimerRef.current)
      }
      writeCachedIframeHeight(config.url, message.height)
      setFrameHeight((currentHeight) => (
        Math.abs(currentHeight - message.height) < HEIGHT_UPDATE_THRESHOLD ? currentHeight : message.height
      ))

      if (!frameReadyRef.current) {
        autoResizeReadyTimerRef.current = window.setTimeout(() => {
          setFrameReady(true)
          frameReadyRef.current = true
          autoResizeReadyTimerRef.current = null
        }, AUTO_RESIZE_SETTLE_MS)
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [config.url])

  useEffect(() => {
    return () => {
      if (loadFallbackTimerRef.current !== null) {
        window.clearTimeout(loadFallbackTimerRef.current)
      }
      if (autoResizeReadyTimerRef.current !== null) {
        window.clearTimeout(autoResizeReadyTimerRef.current)
      }
    }
  }, [])

  return (
    <NodeViewWrapper className="iframe-block-wrapper" data-type="iframe-block">
      <div className="iframe-block-card">
        <button
          className="iframe-block-delete"
          onClick={deleteNode}
          aria-label="Delete iframe block"
        >
          <X size={14} />
        </button>
        <div className="iframe-block-header">
          <div className="iframe-block-header-main">
            <div className="iframe-block-badge">
              <Globe size={13} />
              Iframe
            </div>
            <div className="iframe-block-title-row">
              <div className="iframe-block-title">{title}</div>
              {meta && (
                <div className="iframe-block-host">
                  {meta.host}
                  {meta.path}
                </div>
              )}
            </div>
          </div>
          <a
            href={config.url}
            target="_blank"
            rel="noopener noreferrer"
            className="iframe-block-open"
          >
            <ExternalLink size={13} />
            Open
          </a>
        </div>
        <div
          className={`iframe-block-frame-shell${frameReady ? ' iframe-block-frame-shell-ready' : ' iframe-block-frame-shell-loading'}`}
          style={{ height: frameHeight }}
        >
          {!frameReady && (
            <div className="iframe-block-loading-overlay" aria-hidden="true">
              <div className="iframe-block-loading-bar" />
              <div className="iframe-block-loading-copy">Loading embed…</div>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={config.url}
            title={title}
            className="iframe-block-frame"
            loading="lazy"
            onLoad={() => {
              if (loadFallbackTimerRef.current !== null) {
                window.clearTimeout(loadFallbackTimerRef.current)
              }
              loadFallbackTimerRef.current = window.setTimeout(() => {
                setFrameReady(true)
                loadFallbackTimerRef.current = null
              }, LOAD_FALLBACK_READY_MS)
            }}
            allow={allow}
            allowFullScreen
            sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads"
          />
        </div>
        {config.caption && (
          <div className="iframe-block-caption">{config.caption}</div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const IframeBlockExtension = Node.create({
  name: 'iframeBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      data: {
        default: '{}',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'pre',
        priority: 60,
        getAttrs(element) {
          const code = element.querySelector('code')
          if (!code) return false
          const cls = code.className || ''
          if (cls.includes('language-iframe')) {
            return { data: code.textContent || '{}' }
          }
          return false
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'iframe-block' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(IframeBlockView)
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (text: string) => void; closeBlock: (node: unknown) => void }, node: { attrs: { data: string } }) {
          state.write('```iframe\n' + node.attrs.data + '\n```')
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})
