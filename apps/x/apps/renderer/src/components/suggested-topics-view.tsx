import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Lightbulb, Loader2 } from 'lucide-react'
import { SuggestedTopicBlockSchema, type SuggestedTopicBlock } from '@x/shared/dist/blocks.js'

/** Parse suggestedtopic code-fence blocks from the markdown file content. */
function parseTopics(content: string): SuggestedTopicBlock[] {
  const topics: SuggestedTopicBlock[] = []
  const regex = /```suggestedtopic\s*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim())
      const topic = SuggestedTopicBlockSchema.parse(parsed)
      topics.push(topic)
    } catch {
      // Skip malformed blocks
    }
  }
  return topics
}

const CATEGORY_COLORS: Record<string, string> = {
  Meetings: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  Projects: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  People: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  Topics: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
}

function getCategoryColor(category?: string): string {
  if (!category) return 'bg-muted text-muted-foreground'
  return CATEGORY_COLORS[category] ?? 'bg-muted text-muted-foreground'
}

interface TopicCardProps {
  topic: SuggestedTopicBlock
  onExplore: (topic: SuggestedTopicBlock) => void
}

function TopicCard({ topic, onExplore }: TopicCardProps) {
  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5 transition-all hover:border-border hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold leading-snug text-foreground">
          {topic.title}
        </h3>
        {topic.category && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${getCategoryColor(topic.category)}`}
          >
            {topic.category}
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {topic.description}
      </p>
      <button
        onClick={() => onExplore(topic)}
        className="mt-auto flex w-fit items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
      >
        Explore
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>
  )
}

interface SuggestedTopicsViewProps {
  onExploreTopic: (title: string, description: string) => void
}

export function SuggestedTopicsView({ onExploreTopic }: SuggestedTopicsViewProps) {
  const [topics, setTopics] = useState<SuggestedTopicBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const result = await window.ipc.invoke('workspace:readFile', {
          path: 'config/suggested-topics.md',
        })
        if (cancelled) return
        if (result.data) {
          setTopics(parseTopics(result.data))
        }
      } catch {
        if (!cancelled) setError('No suggested topics yet. Check back once your knowledge graph has more data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const handleExplore = useCallback(
    (topic: SuggestedTopicBlock) => {
      onExploreTopic(topic.title, topic.description)
    },
    [onExploreTopic],
  )

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || topics.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="rounded-full bg-muted p-3">
          <Lightbulb className="size-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          {error ?? 'No suggested topics yet. Check back once your knowledge graph has more data.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border px-6 py-5">
        <div className="flex items-center gap-2">
          <Lightbulb className="size-5 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Suggested Topics</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Topics surfaced from your knowledge graph. Explore them to create new notes.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topics.map((topic, i) => (
            <TopicCard key={`${topic.title}-${i}`} topic={topic} onExplore={handleExplore} />
          ))}
        </div>
      </div>
    </div>
  )
}
