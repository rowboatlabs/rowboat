"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const GOOGLE_CLIENT_ID_SETUP_GUIDE_URL =
  "https://github.com/rowboatlabs/rowboat/blob/main/google-setup.md"

interface GoogleClientIdModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (clientId: string, clientSecret: string) => void
  isSubmitting?: boolean
  description?: string
}

export function GoogleClientIdModal({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
  description,
}: GoogleClientIdModalProps) {
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")

  useEffect(() => {
    if (!open) {
      setClientId("")
      setClientSecret("")
    }
  }, [open])

  const trimmedClientId = clientId.trim()
  const trimmedClientSecret = clientSecret.trim()
  const isValid = trimmedClientId.length > 0 && trimmedClientSecret.length > 0

  const handleSubmit = () => {
    if (!isValid || isSubmitting) return
    onSubmit(trimmedClientId, trimmedClientSecret)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(28rem,calc(100%-2rem))] max-w-md p-0 gap-0 overflow-hidden rounded-xl">
        <div className="p-6 pb-0">
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-lg font-semibold">Google OAuth Credentials</DialogTitle>
            <DialogDescription className="text-sm">
              {description ?? "Enter the credentials for your Google OAuth app to connect."}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block" htmlFor="google-client-id">
              Client ID
            </label>
            <Input
              id="google-client-id"
              placeholder="xxxxxxxxxxxx-xxxx.apps.googleusercontent.com"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  handleSubmit()
                }
              }}
              className="font-mono text-xs"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block" htmlFor="google-client-secret">
              Client Secret
            </label>
            <Input
              id="google-client-secret"
              type="password"
              placeholder="GOCSPX-..."
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  handleSubmit()
                }
              }}
              className="font-mono text-xs"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Need help?{" "}
            <a
              className="text-primary underline underline-offset-4 hover:text-primary/80"
              href={GOOGLE_CLIENT_ID_SETUP_GUIDE_URL}
              target="_blank"
              rel="noreferrer"
            >
              Read the setup guide
            </a>
          </p>
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t bg-muted/30">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
