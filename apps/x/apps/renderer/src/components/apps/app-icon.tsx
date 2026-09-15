import { useState } from 'react'

export function appTitle(name: string) {
  const title = name.replaceAll('-', ' ')
  return title.charAt(0).toUpperCase() + title.slice(1)
}

export function AppIcon({ name, src }: { name: string; src?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const initials = name
    .split(/[-\s]+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase()
  return src && failedSrc !== src ? (
    <img
      src={src}
      alt=""
      className="size-10 rounded-xl object-cover"
      onError={() => setFailedSrc(src)}
    />
  ) : (
    <span
      aria-hidden="true"
      className="flex size-10 items-center justify-center rounded-xl border border-current/10 bg-background/50 text-sm font-semibold text-foreground"
    >
      {initials}
    </span>
  )
}
