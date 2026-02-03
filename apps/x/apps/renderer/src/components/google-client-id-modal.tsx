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

interface GoogleClientIdModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (clientId: string) => void
  isSubmitting?: boolean
}

export function GoogleClientIdModal({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
}: GoogleClientIdModalProps) {
  const [clientId, setClientId] = useState("")

  useEffect(() => {
    if (!open) {
      setClientId("")
    }
  }, [open])

  const trimmedClientId = clientId.trim()
  const isValid = trimmedClientId.length > 0

  const handleSubmit = () => {
    if (!isValid || isSubmitting) return
    onSubmit(trimmedClientId)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enter Google Client ID</DialogTitle>
          <DialogDescription>
            This app does not store the client ID. You will be prompted each session.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="google-client-id">
            Client ID
          </label>
          <Input
            id="google-client-id"
            placeholder="xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                handleSubmit()
              }
            }}
            autoFocus
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
            Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
