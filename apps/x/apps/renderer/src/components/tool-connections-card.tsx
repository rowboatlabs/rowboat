import { useCallback, useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'

import { SettingsDialog } from '@/components/settings-dialog'
import { cn } from '@/lib/utils'

type ToolkitPreview = { slug: string; logo: string; name: string; description: string }

const TOOLKIT_PREVIEW_LIMIT = 8

let cachedToolkitPreviews: ToolkitPreview[] | null = null
let cachedToolkitLogosLoaded = false

function ToolkitPreviewIcon({
  toolkit,
  onInvalid,
}: {
  toolkit: ToolkitPreview
  onInvalid: (slug: string) => void
}) {
  const [loaded, setLoaded] = useState(false)

  if (!loaded) {
    return (
      <img
        src={toolkit.logo}
        alt=""
        className="hidden"
        onLoad={(event) => {
          const img = event.currentTarget
          if (img.naturalWidth > 1 && img.naturalHeight > 1) {
            setLoaded(true)
          } else {
            onInvalid(toolkit.slug)
          }
        }}
        onError={() => onInvalid(toolkit.slug)}
      />
    )
  }

  return (
    <div
      title={`${toolkit.name}: ${toolkit.description}`}
      aria-label={toolkit.name}
      className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60"
    >
      <img
        src={toolkit.logo}
        alt=""
        className="size-5 shrink-0 object-contain"
        onError={() => onInvalid(toolkit.slug)}
      />
    </div>
  )
}

export function ToolConnectionsCard({ className }: { className?: string }) {
  const [toolkitPreviews, setToolkitPreviews] = useState<ToolkitPreview[]>(cachedToolkitPreviews ?? [])
  const [toolkitLogosLoaded, setToolkitLogosLoaded] = useState(cachedToolkitLogosLoaded)
  const [connectionsSettingsOpen, setConnectionsSettingsOpen] = useState(false)

  const loadConnectorLogos = useCallback(async () => {
    if (cachedToolkitLogosLoaded) return
    try {
      const configured = await window.ipc.invoke('composio:is-configured', null)
      if (!configured.configured) return
      const toolkits = await window.ipc.invoke('composio:list-toolkits', {})
      const previews = toolkits.items
        .filter((toolkit) => Boolean(toolkit.meta.logo))
        .slice(0, TOOLKIT_PREVIEW_LIMIT)
        .map((toolkit) => ({
          slug: toolkit.slug,
          logo: toolkit.meta.logo,
          name: toolkit.name,
          description: toolkit.meta.description,
        }))
      cachedToolkitPreviews = previews
      setToolkitPreviews(previews)
    } catch {
      cachedToolkitPreviews = []
    } finally {
      cachedToolkitLogosLoaded = true
      setToolkitLogosLoaded(true)
    }
  }, [])

  const removeToolkitPreview = useCallback((slug: string) => {
    setToolkitPreviews((prev) => {
      const next = prev.filter((toolkit) => toolkit.slug !== slug)
      cachedToolkitPreviews = next
      return next
    })
  }, [])

  useEffect(() => {
    void loadConnectorLogos()
  }, [loadConnectorLogos])

  return (
    <>
      <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] leading-snug">
              <span className="text-muted-foreground">Bring context from and take action in the apps you already use.</span>
            </div>
            <div className="mt-3 flex min-h-5 flex-wrap items-center gap-1.5">
              {toolkitLogosLoaded && toolkitPreviews.map((toolkit) => (
                <ToolkitPreviewIcon
                  key={toolkit.slug}
                  toolkit={toolkit}
                  onInvalid={removeToolkitPreview}
                />
              ))}
              <button
                type="button"
                onClick={() => setConnectionsSettingsOpen(true)}
                className="ml-1 flex h-5 shrink-0 items-center gap-1 rounded-md px-1 text-[12px] font-medium text-primary hover:underline"
              >
                Connections
                <ArrowRight className="size-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <SettingsDialog
        defaultTab="connections"
        open={connectionsSettingsOpen}
        onOpenChange={setConnectionsSettingsOpen}
      />
    </>
  )
}
