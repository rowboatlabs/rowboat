"use client"

import { useCallback, useEffect, useState } from "react"
import type { z } from "zod"
import { Coffee, Loader2, MessageCircle, Send, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import type { ChannelsConfig, ChannelsStatus } from "@x/shared/src/channels.js"

type Config = z.infer<typeof ChannelsConfig>
type Status = z.infer<typeof ChannelsStatus>

// Comma/newline separated entries; each entry keeps digits only, so a
// formatted number like "+1 (415) 555-1234" survives as one entry instead of
// being shattered at the spaces.
function parseIdList(draft: string): string[] {
  return draft
    .split(/[,;\n]+/)
    .map((s) => s.replace(/\D/g, ""))
    .filter(Boolean)
}

export function MobileChannelsSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [tokenDraft, setTokenDraft] = useState("")
  const [waAllowDraft, setWaAllowDraft] = useState("")
  const [tgAllowDraft, setTgAllowDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [caffeinated, setCaffeinated] = useState(false)

  useEffect(() => {
    if (!dialogOpen) return
    let cancelled = false
    void (async () => {
      try {
        const [cfg, st, caf] = await Promise.all([
          window.ipc.invoke("channels:getConfig", null),
          window.ipc.invoke("channels:getStatus", null),
          window.ipc.invoke("power:getCaffeinate", null),
        ])
        if (cancelled) return
        setConfig(cfg)
        setStatus(st)
        setCaffeinated(caf.enabled)
        setTokenDraft(cfg.telegram.botToken)
        setWaAllowDraft(cfg.whatsapp.allowFrom.join(", "))
        setTgAllowDraft(cfg.telegram.allowFrom.join(", "))
      } catch {
        if (!cancelled) toast.error("Failed to load mobile channel settings")
      }
    })()
    const unsubscribe = window.ipc.on("channels:status", (st) => {
      setStatus(st)
    })
    const unsubscribeCaffeinate = window.ipc.on("power:caffeinateChanged", ({ enabled }) => {
      setCaffeinated(enabled)
    })
    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeCaffeinate()
    }
  }, [dialogOpen])

  const save = useCallback(async (next: Config) => {
    setConfig(next)
    setSaving(true)
    try {
      await window.ipc.invoke("channels:setConfig", next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save channel settings")
    } finally {
      setSaving(false)
    }
  }, [])

  if (!config) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    )
  }

  const wa = status?.whatsapp
  const tg = status?.telegram

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2.5 rounded-md bg-muted/50 px-3 py-2.5">
        <Smartphone className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Chat with Rowboat from your phone. Send <span className="font-mono">help</span> for
          commands (<span className="font-mono">list</span>, <span className="font-mono">resume 2</span>,{" "}
          <span className="font-mono">new</span>, <span className="font-mono">stop</span>) — anything
          else is a message to the current chat. Your computer must be on with Rowboat running.
        </p>
      </div>

      {/* Caffeinate */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-muted">
            <Coffee className="size-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">Caffeinate</span>
            <span className="text-xs text-muted-foreground">
              {caffeinated
                ? "Your computer will stay awake while Rowboat is running"
                : "Keep your computer awake so channels stay connected"}
            </span>
          </div>
        </div>
        <Switch
          checked={caffeinated}
          onCheckedChange={(enabled) => {
            setCaffeinated(enabled)
            void window.ipc
              .invoke("power:setCaffeinate", { enabled })
              .then((res) => setCaffeinated(res.enabled))
              .catch(() => {
                setCaffeinated(!enabled)
                toast.error("Failed to update Caffeinate")
              })
          }}
        />
      </div>

      <Separator />

      {/* WhatsApp */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-md bg-muted">
              <MessageCircle className="size-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">WhatsApp</span>
              <span className="text-xs text-muted-foreground">
                {wa?.state === "connected"
                  ? `Linked as +${wa.self ?? "?"} — message yourself to use it`
                  : wa?.state === "qr"
                    ? "Scan the QR below with your phone"
                    : wa?.state === "starting"
                      ? "Connecting…"
                      : wa?.state === "error"
                        ? wa.error ?? "Error"
                        : "Links your own WhatsApp as a companion device"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {wa?.state === "connected" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => {
                  void window.ipc.invoke("channels:whatsappLogout", null).catch(() => {
                    toast.error("Failed to unlink WhatsApp")
                  })
                }}
              >
                Unlink
              </Button>
            )}
            <Switch
              checked={config.whatsapp.enabled}
              disabled={saving}
              onCheckedChange={(enabled) =>
                void save({ ...config, whatsapp: { ...config.whatsapp, enabled } })
              }
            />
          </div>
        </div>

        {config.whatsapp.enabled && wa?.state === "qr" && wa.qrDataUrl && (
          <div className="flex items-center gap-4 rounded-md border p-3">
            <img src={wa.qrDataUrl} alt="WhatsApp pairing QR" className="size-40 rounded" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Link Rowboat to WhatsApp</p>
              <p>1. Open WhatsApp on your phone</p>
              <p>2. Settings → Linked Devices → Link a Device</p>
              <p>3. Scan this code</p>
              <p className="pt-1">
                Then message <span className="font-medium">yourself</span> (your own contact) to talk
                to Rowboat.
              </p>
            </div>
          </div>
        )}

        {config.whatsapp.enabled && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Additional allowed numbers</label>
            <div className="flex gap-2">
              <Input
                value={waAllowDraft}
                onChange={(e) => setWaAllowDraft(e.target.value)}
                placeholder="e.g. 14155551234, 919876543210"
                className="h-8 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                disabled={saving}
                onClick={() =>
                  void save({
                    ...config,
                    whatsapp: { ...config.whatsapp, allowFrom: parseIdList(waAllowDraft) },
                  })
                }
              >
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your own number (self-chat) is always allowed. Digits only, with country code.
            </p>
          </div>
        )}
      </div>

      <Separator />

      {/* Telegram */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-md bg-muted">
              <Send className="size-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">Telegram</span>
              <span className="text-xs text-muted-foreground">
                {tg?.state === "polling"
                  ? `Listening${tg.botUsername ? ` as @${tg.botUsername}` : ""}`
                  : tg?.state === "starting"
                    ? "Connecting…"
                    : tg?.state === "error"
                      ? tg.error ?? "Error"
                      : "Uses your own bot — create one with @BotFather"}
              </span>
            </div>
          </div>
          <Switch
            checked={config.telegram.enabled}
            disabled={saving}
            onCheckedChange={(enabled) =>
              void save({ ...config, telegram: { ...config.telegram, enabled } })
            }
          />
        </div>

        {config.telegram.enabled && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Bot token</label>
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  placeholder="123456789:AAF…"
                  className="h-8 text-xs font-mono"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  disabled={saving}
                  onClick={() =>
                    void save({
                      ...config,
                      telegram: { ...config.telegram, botToken: tokenDraft.trim() },
                    })
                  }
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Message @BotFather on Telegram → /newbot → paste the token here.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Allowed chat IDs</label>
              <div className="flex gap-2">
                <Input
                  value={tgAllowDraft}
                  onChange={(e) => setTgAllowDraft(e.target.value)}
                  placeholder="e.g. 123456789"
                  className="h-8 text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  disabled={saving}
                  onClick={() =>
                    void save({
                      ...config,
                      telegram: { ...config.telegram, allowFrom: parseIdList(tgAllowDraft) },
                    })
                  }
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Message your bot once — it replies with your chat ID to add here.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
