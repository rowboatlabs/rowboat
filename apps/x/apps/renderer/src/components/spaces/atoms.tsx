import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { spaces } from '@x/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { avatarColorClass, initials, orgMonogram } from '@/lib/spaces-presentation'
import { toast } from '@/lib/toast'

// Shared atoms for the Spaces surfaces: identity visuals, the segmented
// control, the dev add-org dialog, and the @rowboat trigger.

// ---------------------------------------------------------------------------
// Identity atoms
// ---------------------------------------------------------------------------

export function MemberAvatar({ id, name, size = 'md', className }: {
    id: string
    name: string
    size?: 'sm' | 'md' | 'lg'
    className?: string
}) {
    const dims = size === 'sm' ? 'size-5 text-[9px]' : size === 'lg' ? 'size-8 text-xs' : 'size-7 text-[10.5px]'
    return (
        <span
            title={name}
            className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none select-none', dims, avatarColorClass(id), className)}
        >
            {initials(name)}
        </span>
    )
}

export function OrgMonogram({ org, size = 'md', className }: {
    org: { name: string; address: string }
    size?: 'sm' | 'md'
    className?: string
}) {
    const dims = size === 'sm' ? 'size-4 text-[8px] rounded-[3px]' : 'size-6 text-[10px] rounded-md'
    return (
        <span
            title={org.address}
            className={cn('inline-flex shrink-0 items-center justify-center bg-foreground text-background font-bold leading-none select-none', dims, className)}
        >
            {orgMonogram(org)}
        </span>
    )
}

export function AvatarStack({ members, max = 5 }: { members: spaces.Member[]; max?: number }) {
    const shown = members.slice(0, max)
    return (
        <div className="flex items-center -space-x-1.5">
            {shown.map((m) => (
                <MemberAvatar key={m.id} id={m.id} name={m.displayName} size="md" className="ring-2 ring-background" />
            ))}
            {members.length > max && (
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background">
                    +{members.length - max}
                </span>
            )}
        </div>
    )
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: {
    value: T
    options: Array<{ value: T; label: string }>
    onChange: (value: T) => void
    size?: 'sm' | 'md'
}) {
    return (
        <div className={cn('inline-flex items-center rounded-lg bg-muted p-0.5', size === 'sm' ? 'text-xs' : 'text-[13px]')}>
            {options.map((opt) => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    className={cn(
                        'rounded-md font-medium transition-colors',
                        size === 'sm' ? 'px-2 py-0.5' : 'px-3 py-1',
                        value === opt.value
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    )
}


export function AddOrgDialog({ open, onOpenChange, onAdded }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onAdded: () => void
}) {
    const [baseUrl, setBaseUrl] = useState('http://localhost:4272')
    const [memberId, setMemberId] = useState('')
    const [busy, setBusy] = useState(false)

    const add = async () => {
        if (!baseUrl.trim() || !memberId.trim()) return
        setBusy(true)
        try {
            const { org } = await window.ipc.invoke('spaces:addOrg', { baseUrl: baseUrl.trim(), memberId: memberId.trim() })
            toast(`Signed into ${org.name} as ${org.memberId}`, 'success')
            onOpenChange(false)
            onAdded()
        } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not reach the org', 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Add an org</DialogTitle>
                    <DialogDescription>
                        Dev sign-in against a stub Harbor (run <code>pnpm dev</code> in <code>apps/harbor/packages/server</code>).
                        The real org sign-in is an OAuth journey and replaces this form.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Org address</label>
                        <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:4272" />
                    </div>
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Member id</label>
                        <Input
                            value={memberId}
                            onChange={(e) => setMemberId(e.target.value)}
                            placeholder="e.g. ramnique"
                            onKeyDown={(e) => e.key === 'Enter' && void add()}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button onClick={() => void add()} disabled={busy || !baseUrl.trim() || !memberId.trim()}>
                            {busy && <Loader2 className="size-3.5 mr-1 animate-spin" />} Sign in
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

