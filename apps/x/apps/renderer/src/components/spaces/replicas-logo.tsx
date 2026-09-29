import { cn } from '@/lib/utils'

/** The Replicas mark (replicas.dev/R-logo-new.svg), cropped to its glyph. */
export function ReplicasLogo({ className }: { className?: string }) {
    return <svg viewBox="0 0 225 300" fill="#3eeba3" aria-hidden="true" className={cn('size-3.5 shrink-0', className)}>
        <path d="M0 0H150V75H0Z" />
        <path d="M150 75H225V150H150Z" />
        <path d="M0 150H150V225H0Z" />
        <path d="M0 225H75V300H0Z" />
        <path d="M150 225H225V300H150Z" />
    </svg>
}
