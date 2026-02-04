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

interface ComposioApiKeyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (apiKey: string) => void
  isSubmitting?: boolean
}

export function ComposioApiKeyModal({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
}: ComposioApiKeyModalProps) {
  const [apiKey, setApiKey] = useState("")

  useEffect(() => {
    if (!open) {
      setApiKey("")
    }
  }, [open])

  const trimmedApiKey = apiKey.trim()
  const isValid = trimmedApiKey.length > 0

  const handleSubmit = () => {
    if (!isValid || isSubmitting) return
    onSubmit(trimmedApiKey)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enter Composio API Key</DialogTitle>
          <DialogDescription>
            Get your API key from{" "}
            <a
              href="https://app.composio.dev/settings"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              app.composio.dev/settings
            </a>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="composio-api-key">
            API Key
          </label>
          <Input
            id="composio-api-key"
            type="password"
            placeholder="Enter your Composio API key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
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
