import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bell, ChevronRight } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

/** Pointer grace bridges the portal gap without trapping focus (2026-11-09). */
export function NotificationMenu({ children, paused }: { children: ReactNode; paused: boolean }) {
    const [open, setOpen] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const keyboard = useRef(false)
    const trigger = useRef<HTMLButtonElement>(null)
    function cancelClose() { clearTimeout(timer.current) }
    function closeSoon() {
        cancelClose()
        if (!keyboard.current) timer.current = setTimeout(() => setOpen(false), 120)
    }
    useEffect(() => {
        const close = () => setOpen(false)
        window.addEventListener('blur', close)
        return () => { clearTimeout(timer.current); window.removeEventListener('blur', close) }
    }, [])
    return <DropdownMenu open={open} modal={false} onOpenChange={next => { cancelClose(); setOpen(next) }}>
        <DropdownMenuTrigger asChild>
            <button ref={trigger} type="button" className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent"
                onPointerEnter={event => { if (event.pointerType === 'mouse') { keyboard.current = false; cancelClose(); setOpen(true) } }}
                onPointerLeave={event => { if (event.pointerType === 'mouse') closeSoon() }}
                onPointerDown={event => { if (event.pointerType === 'mouse' && open) event.preventDefault(); keyboard.current = false }}
                onKeyDown={() => { keyboard.current = true; cancelClose() }}>
                <Bell className="size-4 text-muted-foreground" /><span className="flex-1">Notifications</span>
                {paused && <span className="text-xs text-muted-foreground">Paused</span>}<ChevronRight className="size-3.5 text-muted-foreground" />
            </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" sideOffset={4} className="w-64 rounded-xl border border-border/60 data-[state=open]:animate-none data-[state=closed]:animate-none"
            onPointerEnter={cancelClose} onPointerLeave={event => { if (event.pointerType === 'mouse') closeSoon() }}
            onKeyDown={() => { keyboard.current = true; cancelClose() }}
            onCloseAutoFocus={event => { event.preventDefault(); if (keyboard.current) trigger.current?.focus() }}
            onFocusOutside={() => setOpen(false)}>
            {children}
        </DropdownMenuContent>
    </DropdownMenu>
}
