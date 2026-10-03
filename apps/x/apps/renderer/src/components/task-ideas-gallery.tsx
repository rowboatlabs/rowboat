import { TASK_IDEAS } from '@/lib/task-ideas'

// Ready-made scheduled tasks, on the page itself (Baarali, 03/10/2026): the
// founder looked for the ideas validated in the mockup and found them only
// behind « New task ». A click opens the dialog with the idea written in.

export function TaskIdeasGallery({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <section className="mt-6">
      <h3 className="text-[15px] font-semibold">Ready-made ideas</h3>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Pick one: Baarali fills in the task, you adjust it, then create it.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {TASK_IDEAS.map((idea) => (
          <button
            key={idea.title}
            type="button"
            onClick={() => onPick(idea.prompt)}
            className="flex flex-col gap-2 rounded-xl border bg-background p-3.5 text-left transition-colors hover:border-primary hover:bg-primary/5"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <idea.icon className="size-4" />
            </span>
            <span className="text-[13.5px] font-medium leading-snug">{idea.title}</span>
            <span className="text-[11.5px] text-muted-foreground">{idea.when}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
