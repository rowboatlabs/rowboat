import { useState } from 'react'
import { Plug } from 'lucide-react'
import { cn } from '@/lib/utils'
import { connectionLogo } from '@/lib/spaces-connections'

/**
 * A connected app's mark (spec §8 Space connections, 2026-11-28): its logo
 * from the catalogue, or a plug where the client holds none or it did not
 * load. A square tile, since circles are an agent's and a connection is not
 * one: nobody asks it anything.
 */
export function ConnectionLogo({ app, title, className }: {
    app: { name: string; logo?: string | undefined } | undefined
    /** What hovering says: the app's name unless the tile stands for something else, a member. */
    title?: string
    className?: string
}) {
    const logo = connectionLogo(app)
    const [failed, setFailed] = useState<string>()
    return (
        <span
            data-slot="connection-logo"
            title={title ?? app?.name}
            className={cn('inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background text-muted-foreground', className)}
        >
            {logo && failed !== logo
                ? <img src={logo} alt="" className="size-[72%] object-contain" onError={() => setFailed(logo)} />
                : <Plug aria-hidden className="size-1/2" />}
        </span>
    )
}
