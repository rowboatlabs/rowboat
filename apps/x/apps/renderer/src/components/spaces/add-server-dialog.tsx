import { ArrowRight, LogIn, Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function AddServerDialog({ onClose, onChoose }: {
    onClose: () => void
    onChoose: (kind: 'create' | 'join') => void
}) {
    return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent className="max-w-md">
            <DialogHeader>
                <DialogTitle>New group chat</DialogTitle>
                <DialogDescription>Start one with your people, or join one you were invited to.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 pt-1">
                <button type="button" onClick={() => onChoose('create')}
                    className="group flex items-center gap-4 rounded-xl border border-border bg-accent/30 p-4 text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Plus className="size-5" /></span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">Create a group chat</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Name it, invite people, start talking. Add channels when it grows into a team.</span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                </button>
                <button type="button" onClick={() => onChoose('join')}
                    className="group flex items-center gap-4 rounded-xl border border-border p-4 text-left transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><LogIn className="size-5" /></span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">Join a server</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">Have an invite? Connect with your team.</span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                </button>
            </div>
        </DialogContent>
    </Dialog>
}
