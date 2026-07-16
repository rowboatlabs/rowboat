"use client"

import { useCallback, useEffect, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { Copy, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"

type PairingInfo = {
  running: boolean
  name: string
  port: number | null
  lanEnabled: boolean
  urls: string[]
  token: string | null
}

export function PhonePairingSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [info, setInfo] = useState<PairingInfo | null>(null)
  const [toggling, setToggling] = useState(false)
  const [rotating, setRotating] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setInfo(await window.ipc.invoke("server:getPairingInfo", null))
    } catch {
      toast.error("Failed to load pairing info")
    }
  }, [])

  useEffect(() => {
    if (dialogOpen) void refresh()
  }, [dialogOpen, refresh])

  const handleLanToggle = async (enabled: boolean) => {
    setToggling(true)
    try {
      await window.ipc.invoke("server:setLanEnabled", { enabled })
      await refresh()
    } catch {
      toast.error("Failed to update network setting")
    } finally {
      setToggling(false)
    }
  }

  const handleRotate = async () => {
    setRotating(true)
    try {
      await window.ipc.invoke("server:rotateKey", null)
      await refresh()
      toast.success("New pairing code created — re-pair your phone")
    } catch {
      toast.error("Failed to reset the pairing code")
    } finally {
      setRotating(false)
    }
  }

  if (!info) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading...
      </div>
    )
  }

  if (!info.running || !info.token) {
    return (
      <div className="text-sm text-muted-foreground">
        The connection server isn&apos;t running. Restart Rowboat and try again.
      </div>
    )
  }

  // The exact JSON the phone app expects in the QR (see @x/server pairing.ts).
  const token = info.token
  const qrPayload = JSON.stringify({ v: 1, name: info.name, urls: info.urls, token })
  const primaryUrl = info.urls[info.lanEnabled ? 1 : 0] ?? info.urls[0]

  const copy = (label: string, value: string) => {
    void navigator.clipboard.writeText(value)
    toast.success(`${label} copied`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium">Allow connections from your network</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Lets your phone reach this Mac over Wi-Fi or Tailscale. Anyone with the
            pairing code below can read your notes and chat as you — only turn this
            on for networks you trust.
          </div>
        </div>
        <Switch checked={info.lanEnabled} onCheckedChange={handleLanToggle} disabled={toggling} />
      </div>

      {info.lanEnabled ? (
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-medium">Pair your phone</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Open the Rowboat app on your phone and scan this code. Both devices need
              to be on the same network.
            </p>
          </div>
          <div className="inline-block rounded-lg border bg-white p-3">
            <QRCodeSVG value={qrPayload} size={192} />
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Turn on network access to show the pairing code.
        </p>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Manual pairing</h4>
        <p className="text-xs text-muted-foreground">
          For the iOS simulator or if scanning fails, enter these in the phone app.
        </p>
        <div className="flex items-center gap-2 text-xs">
          <code className="rounded bg-muted px-2 py-1 font-mono">{primaryUrl}</code>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => copy("Server address", primaryUrl)}>
            <Copy className="size-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <code className="rounded bg-muted px-2 py-1 font-mono truncate max-w-[280px]">{token}</code>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => copy("Pairing token", token)}>
            <Copy className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Reset pairing</h4>
        <p className="text-xs text-muted-foreground">
          Creates a new pairing code. Every paired phone is disconnected and has to
          pair again — use this if the code may have leaked.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={rotating}
          onClick={handleRotate}
        >
          {rotating ? "Resetting…" : "Reset pairing code"}
        </Button>
      </div>
    </div>
  )
}
