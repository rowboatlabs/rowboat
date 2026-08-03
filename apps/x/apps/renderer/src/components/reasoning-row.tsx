import * as React from 'react'
import { ChevronDownIcon, LoaderIcon } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  ToolContent,
  quietRowContainerClass,
  quietRowGlyphSlotClass,
  quietRowTriggerClass,
} from '@/components/ai-elements/tool'
import { cn } from '@/lib/utils'

// The model's thought process as a quiet row — same 13px line, lead glyph
// slot, and collapse mechanics as the tool rows (spinner while streaming,
// chevron once settled, expanded text hanging off the hairline rule). A
// streaming row opens itself and collapses when the model moves on to its
// answer; settled rows load collapsed.
export function ReasoningRow({
  content,
  isStreaming = false,
  className,
}: {
  content: string
  isStreaming?: boolean
  className?: string
}) {
  const [open, setOpen] = React.useState(isStreaming)
  // Only the live row knows how long the model actually thought; durable
  // rows mount settled and fall back to the vague label.
  const [duration, setDuration] = React.useState<number | undefined>(undefined)
  const startedAt = React.useRef<number | null>(isStreaming ? Date.now() : null)
  const wasStreaming = React.useRef(isStreaming)
  React.useEffect(() => {
    if (!wasStreaming.current && isStreaming) {
      startedAt.current = Date.now()
      setOpen(true)
    } else if (wasStreaming.current && !isStreaming) {
      if (startedAt.current !== null) {
        setDuration(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)))
        startedAt.current = null
      }
      setOpen(false)
    }
    wasStreaming.current = isStreaming
  }, [isStreaming])

  const label =
    duration === undefined
      ? 'Thought for a few seconds'
      : `Thought for ${duration} second${duration !== 1 ? 's' : ''}`
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn(quietRowContainerClass, className)}>
      <CollapsibleTrigger className={quietRowTriggerClass}>
        <span className={quietRowGlyphSlotClass}>
          {isStreaming ? (
            <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="size-3 text-muted-foreground/50 transition-transform group-data-[state=open]/row:rotate-180" />
          )}
        </span>
        {isStreaming ? (
          <Shimmer as="span" duration={1} className="shrink-0 font-medium">
            Thinking...
          </Shimmer>
        ) : (
          <span className="shrink-0 font-medium text-muted-foreground">{label}</span>
        )}
      </CollapsibleTrigger>
      <ToolContent>
        <div className="text-sm text-muted-foreground">
          <Streamdown>{content}</Streamdown>
        </div>
      </ToolContent>
    </Collapsible>
  )
}
