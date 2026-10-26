import { keyLabel, type ShortcutKeys } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

/** A shortcut as one small chip per key (⌘ · N). `tone="dark"` sits on a tooltip. */
export function Keys({ keys, tone = 'plain', className }: {
    keys: ShortcutKeys
    tone?: 'plain' | 'dark'
    className?: string
}) {
    return (
        <span className={cn('keys', tone === 'dark' && 'keys--dark', className)} aria-hidden="true">
            {keys.map((key) => <kbd key={key} className="key">{keyLabel(key)}</kbd>)}
        </span>
    )
}
