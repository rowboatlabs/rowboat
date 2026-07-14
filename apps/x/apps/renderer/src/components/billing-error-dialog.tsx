import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { BillingErrorMatch } from "@/lib/billing-error"
import * as analytics from "@/lib/analytics"

interface BillingRowboatAccount {
  config?: {
    appUrl?: string | null
  } | null
}

interface BillingErrorDialogProps {
  open: boolean
  match: BillingErrorMatch | null
  onOpenChange: (open: boolean) => void
}

export function BillingErrorDialog({ open, match, onOpenChange }: BillingErrorDialogProps) {
  const [appUrl, setAppUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    window.ipc
      .invoke('account:getRowboat', null)
      .then((account: BillingRowboatAccount) => setAppUrl(account.config?.appUrl ?? null))
      .catch(() => {})
  }, [open])

  useEffect(() => {
    if (open && match) analytics.billingErrorShown(match.kind)
  }, [open, match])

  if (!match) return null

  const handleUpgrade = () => {
    analytics.billingUpgradeClicked(match.kind)
    if (appUrl) window.open(`${appUrl}?intent=upgrade`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{match.title}</DialogTitle>
          <DialogDescription>{match.subtitle}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Dismiss
          </Button>
          <Button onClick={handleUpgrade} disabled={!appUrl}>
            {match.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
