import { Shimmer } from '@/components/ai-elements/shimmer'

export function TurnActivityIndicator({ isReasoning }: { isReasoning: boolean }) {
  if (isReasoning) {
    return <div role="status"><Shimmer duration={1}>Thinking...</Shimmer></div>
  }

  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="relative flex size-2" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-40" />
        <span className="relative inline-flex size-2 rounded-full bg-current" />
      </span>
      <span>Working...</span>
    </div>
  )
}
