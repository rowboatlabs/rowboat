"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, User, CreditCard, LogOut, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Separator } from "@/components/ui/separator"
import { useBilling } from "@/hooks/useBilling"
import { toast } from "sonner"

interface AccountSettingsProps {
  dialogOpen: boolean
}

export function AccountSettings({ dialogOpen }: AccountSettingsProps) {
  const [isRowboatConnected, setIsRowboatConnected] = useState(false)
  const [connectionLoading, setConnectionLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [appUrl, setAppUrl] = useState<string | null>(null)
  const { billing, isLoading: billingLoading } = useBilling(isRowboatConnected)

  const checkConnection = useCallback(async () => {
    try {
      setConnectionLoading(true)
      const result = await window.ipc.invoke('oauth:getState', null)
      const connected = result.config?.rowboat?.connected ?? false
      setIsRowboatConnected(connected)
    } catch {
      setIsRowboatConnected(false)
    } finally {
      setConnectionLoading(false)
    }
  }, [])

  useEffect(() => {
    if (dialogOpen) {
      checkConnection()
    }
  }, [dialogOpen, checkConnection])

  useEffect(() => {
    if (isRowboatConnected) {
      window.ipc.invoke('account:getRowboat', null)
        .then((account) => setAppUrl(account.config?.appUrl ?? null))
        .catch(() => {})
    }
  }, [isRowboatConnected])

  useEffect(() => {
    const cleanup = window.ipc.on('oauth:didConnect', (event) => {
      if (event.provider === 'rowboat') {
        setIsRowboatConnected(event.success)
        setConnecting(false)
        if (event.success) {
          toast.success('Logged in to Rowboat')
        }
      }
    })
    return cleanup
  }, [])

  const handleConnect = useCallback(async () => {
    try {
      setConnecting(true)
      const result = await window.ipc.invoke('oauth:connect', { provider: 'rowboat' })
      if (!result.success) {
        toast.error(result.error || 'Failed to log in to Rowboat')
        setConnecting(false)
      }
    } catch {
      toast.error('Failed to log in to Rowboat')
      setConnecting(false)
    }
  }, [])

  const handleDisconnect = useCallback(async () => {
    try {
      setDisconnecting(true)
      const result = await window.ipc.invoke('oauth:disconnect', { provider: 'rowboat' })
      if (result.success) {
        setIsRowboatConnected(false)
        toast.success('Logged out of Rowboat')
      } else {
        toast.error('Failed to log out of Rowboat')
      }
    } catch {
      toast.error('Failed to log out of Rowboat')
    } finally {
      setDisconnecting(false)
    }
  }, [])

  if (connectionLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isRowboatConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted">
          <User className="size-7 text-muted-foreground" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium">Not logged in</p>
          <p className="text-xs text-muted-foreground">Log in to your Rowboat account to access premium features</p>
        </div>
        <Button onClick={handleConnect} disabled={connecting}>
          {connecting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
          Log in to Rowboat
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Profile Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
            <User className="size-6 text-primary" />
          </div>
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {billing?.userEmail ?? 'Loading...'}
            </p>
            <p className="text-xs text-muted-foreground">Rowboat Account</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Plan Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Plan</h4>
        </div>

        {billingLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Loading plan details...
          </div>
        ) : billing ? (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium capitalize">
                  {billing.subscriptionPlan ? `${billing.subscriptionPlan} Plan` : 'No Plan'}
                </p>
                {billing.subscriptionStatus === 'trialing' && billing.trialExpiresAt ? (() => {
                  const days = Math.max(0, Math.ceil((new Date(billing.trialExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
                  return (
                    <p className="text-xs text-muted-foreground">
                      Trial · {days === 0 ? 'expires today' : days === 1 ? '1 day left' : `${days} days left`}
                    </p>
                  )
                })() : billing.subscriptionStatus ? (
                  <p className="text-xs text-muted-foreground capitalize">{billing.subscriptionStatus}</p>
                ) : null}
                {!billing.subscriptionPlan && (
                  <p className="text-xs text-muted-foreground">Subscribe to access AI features</p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => appUrl && window.open(`${appUrl}?intent=upgrade`)}>
                {!billing.subscriptionPlan ? 'Subscribe' : 'Change plan'}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Unable to load plan details</p>
        )}
      </div>

      <Separator />

      {/* Payment Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Payment</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Manage invoices, payment methods, and billing details.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={!billing?.subscriptionPlan}
          onClick={() => appUrl && window.open(appUrl)}
          className="gap-1.5"
        >
          <ExternalLink className="size-3" />
          Manage in Stripe
        </Button>
        {!billing?.subscriptionPlan && (
          <p className="text-[11px] text-muted-foreground">Subscribe to a plan first</p>
        )}
      </div>

      <Separator />

      {/* Log Out Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <LogOut className="size-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Log Out</h4>
        </div>
        <p className="text-xs text-muted-foreground">
          Logging out will remove access to synced data and Rowboat-provided models.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
              Log Out
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Log out of your Rowboat account?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove access to synced data and Rowboat-provided models. You can log back in at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {disconnecting ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                Log Out
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
