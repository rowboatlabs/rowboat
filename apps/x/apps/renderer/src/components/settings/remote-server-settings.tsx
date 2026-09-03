"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"

type ConnectionInfo = {
  mode: "in-process" | "child" | "remote"
  url: string | null
  fromEnv: boolean
}

// Settings → Connect to server: point this desktop at a rowboat-server on
// another machine (address + access code from that machine's
// ~/.rowboat/server-key), or go back to running everything locally. On a
// successful switch main reloads every window, so this component only has to
// deliver the toast before the reload lands.
export function RemoteServerSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [info, setInfo] = useState<ConnectionInfo | null>(null)
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setInfo(await window.ipc.invoke("server:getConnection", null))
    } catch {
      toast.error("Failed to load connection state")
    }
  }, [])

  useEffect(() => {
    if (dialogOpen) void refresh()
  }, [dialogOpen, refresh])

  if (!info) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading...
      </div>
    )
  }

  const handleConnect = async () => {
    setBusy(true)
    try {
      const result = await window.ipc.invoke("server:connectRemote", { url, token })
      if (result.success) {
        toast.success("Connected — reloading…")
      } else {
        toast.error(result.error ?? "Could not connect")
        setBusy(false)
      }
    } catch {
      toast.error("Could not connect")
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    setBusy(true)
    try {
      const result = await window.ipc.invoke("server:disconnectRemote", null)
      if (result.success) {
        toast.success("Back to this Mac — reloading…")
      } else {
        toast.error(result.error ?? "Could not disconnect")
        setBusy(false)
      }
    } catch {
      toast.error("Could not disconnect")
      setBusy(false)
    }
  }

  if (info.fromEnv) {
    return (
      <div className="space-y-2">
        <div className="text-sm">
          Connected to <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{info.url}</code>
        </div>
        <p className="text-xs text-muted-foreground">
          This connection is set by environment variables (ROWBOAT_REMOTE_SERVER), so it
          can&apos;t be changed here. Relaunch the app without them to manage it from Settings.
        </p>
      </div>
    )
  }

  if (info.mode === "remote") {
    return (
      <div className="space-y-3">
        <div className="text-sm">
          Connected to <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{info.url}</code>
        </div>
        <p className="text-xs text-muted-foreground">
          Your chats, notes, and connectors live on that machine. Disconnect to go back
          to running everything on this Mac.
        </p>
        <Button variant="outline" size="sm" disabled={busy} onClick={handleDisconnect}>
          {busy ? "Disconnecting…" : "Disconnect — use this Mac"}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Run Rowboat against a server on another machine. Enter its address and the
        access code from <code className="font-mono">~/.rowboat/server-key</code> on that
        machine. Everything — chats, notes, connectors — will live there.
      </p>
      <div className="space-y-2">
        <Input
          placeholder="http://100.x.y.z:3220"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="font-mono text-xs"
        />
        <Input
          placeholder="Access code"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="font-mono text-xs"
        />
      </div>
      <Button size="sm" disabled={busy || !url.trim() || !token.trim()} onClick={handleConnect}>
        {busy ? "Connecting…" : "Connect"}
      </Button>
    </div>
  )
}
