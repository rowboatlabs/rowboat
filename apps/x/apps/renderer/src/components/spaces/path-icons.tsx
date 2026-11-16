// The New agent chooser's three paths, drawn for it (2026-10-28): a laptop
// with a prompt on screen, a cloud that runs things, and two connectors
// meeting. Line art in currentColor with a soft fill, so they follow the theme.

const base = { width: 28, height: 28, viewBox: '0 0 28 28', fill: 'none', 'aria-hidden': true } as const
const line = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** On this computer: a laptop with a terminal prompt. */
export function ThisComputerIcon({ className }: { className?: string }) {
    return (
        <svg {...base} className={className}>
            <rect x="5" y="6" width="18" height="12" rx="1.5" fill="currentColor" fillOpacity="0.08" {...line} />
            <path d="M3 21.5h22" {...line} />
            <path d="M9 10.5l2.5 2-2.5 2" {...line} />
            <path d="M13.5 14.5h4" {...line} />
        </svg>
    )
}

/** Rowboat runs it: a cloud with a spark of work in it. */
export function RowboatRunsIcon({ className }: { className?: string }) {
    return (
        <svg {...base} className={className}>
            <path d="M8.5 21h11a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 8.4 11.1 5 5 0 0 0 8.5 21Z" fill="currentColor" fillOpacity="0.08" {...line} />
            <path d="M14 12.25c.45 1.75 1.05 2.35 2.75 2.75-1.7.4-2.3 1-2.75 2.75-.45-1.75-1.05-2.35-2.75-2.75 1.7-.4 2.3-1 2.75-2.75Z" fill="currentColor" {...line} strokeWidth={1} />
        </svg>
    )
}

/** Connect one you already run: a plug, its cord trailing off. */
export function ConnectIcon({ className }: { className?: string }) {
    return (
        <svg {...base} className={className}>
            <path d="M11 3.5v4.25M17 3.5v4.25" {...line} />
            <path d="M8 7.75h12v4.5a6 6 0 0 1-12 0v-4.5Z" fill="currentColor" fillOpacity="0.08" {...line} />
            <path d="M14 18.25v2.25a3 3 0 0 0 3 3h2.5" {...line} />
        </svg>
    )
}

/** A bot: a speech bubble that answers commands. */
export function BotIcon({ className }: { className?: string }) {
    return (
        <svg {...base} className={className}>
            <path d="M6 7.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-9l-4.5 3.5v-3.5H6A1.5 1.5 0 0 1 4.5 18V9A1.5 1.5 0 0 1 6 7.5Z" fill="currentColor" fillOpacity="0.08" {...line} />
            <path d="M10 12.5v1.5M18 12.5v1.5" {...line} />
        </svg>
    )
}
