"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface ComposioGoogleMigrationModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onReconnect: () => void
}

/**
 * One-time modal shown to signed-in users who had Gmail/Calendar connected
 * via Composio before the native rowboat-mode OAuth flow shipped. By the
 * time this opens, the Composio Google accounts have already been
 * disconnected (fire-and-forget, on the qualification IPC) — the modal
 * just explains what happened and offers a one-click reconnect.
 *
 * Both buttons close the modal. The qualification IPC marks the migration
 * as dismissed before showing this, so neither button needs a follow-up
 * IPC of its own.
 */
export function ComposioGoogleMigrationModal({
  open,
  onOpenChange,
  onReconnect,
}: ComposioGoogleMigrationModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(28rem,calc(100%-2rem))] max-w-md p-0 gap-0 overflow-hidden rounded-xl">
        <div className="p-6 pb-0">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-semibold">
              Reconnect Google to resume syncing
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm leading-relaxed">
                <p>
                  Knowledge graph syncing for Gmail and Calendar now uses a
                  direct Google connection. Reconnect to resume. Your existing
                  emails and events stay where they are.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 mt-6 border-t bg-muted/30">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            I&apos;ll do this later
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onReconnect()
              onOpenChange(false)
            }}
          >
            Reconnect Google
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
