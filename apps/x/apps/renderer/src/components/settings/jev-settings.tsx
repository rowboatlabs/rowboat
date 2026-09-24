import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { TYPESAFE_CONFIG_EVENT, setTagSuggestionsEnabled, useTagSuggestionsEnabled } from "@/lib/spaces-auto-route"

// Jev (TypeSafe) under Settings > Models > Decision Models (2026-09-23; it
// began under Connections on 2026-09-22): the bring-your-own-key card behind
// the Spaces composer's Auto toggle. Not a provider in the Providers list:
// Jev answers typed questions, not chat, so it has no models for the
// pickers and can never be the Assistant model. Same shape as the Composio
// key section: the renderer only ever learns whether a key is set.

export function JevSettings({ dialogOpen }: { dialogOpen: boolean }) {
  const [configured, setConfigured] = useState(false)
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState("")
  const [saving, setSaving] = useState(false)
  const tagSuggestions = useTagSuggestionsEnabled()

  const refresh = useCallback(async () => {
    try {
      const result = await window.ipc.invoke("typesafe:isConfigured", null)
      setConfigured(result.configured)
    } catch {
      setConfigured(false)
    }
  }, [])

  useEffect(() => {
    if (dialogOpen) void refresh()
  }, [dialogOpen, refresh])

  const save = async () => {
    const apiKey = input.trim()
    if (!apiKey || saving) return
    setSaving(true)
    try {
      const result = await window.ipc.invoke("typesafe:setApiKey", { apiKey })
      if (!result.success) {
        toast.error(result.error ?? "Could not save the Jev API key")
        return
      }
      setConfigured(true)
      setEditing(false)
      setInput("")
      // The composers gate their Auto pill and /find on this; tell them now.
      window.dispatchEvent(new Event(TYPESAFE_CONFIG_EVENT))
      if (result.warning) toast.warning(result.warning)
      else toast.success("Jev API key saved")
    } catch {
      toast.error("Could not save the Jev API key")
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    try {
      await window.ipc.invoke("typesafe:clearApiKey", null)
      setConfigured(false)
      setEditing(false)
      window.dispatchEvent(new Event(TYPESAFE_CONFIG_EVENT))
      toast("Jev API key removed")
    } catch {
      toast.error("Could not remove the Jev API key")
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Jev is TypeSafe's System One model: it answers typed questions rather than chat, so it does not appear in the
        model pickers above. A key adds an Auto toggle beside @rowboat in a space's composer, which lets Jev decide
        whether a message starts something new or replies to an open thread, and a /find command that jumps to the
        message you describe. Without a key, nothing changes. Get a key from{" "}
        <a
          href="https://console.typesafe.ai/keys"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          console.typesafe.ai/keys
        </a>
      </p>
      {configured && !editing ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-sm text-[var(--rowboat-success)]">
            <CheckCircle2 className="size-4" />
            API key configured
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Change
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            type="password"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your TypeSafe API key"
            onKeyDown={(e) => { if (e.key === "Enter") void save() }}
            className="flex-1"
          />
          <Button onClick={() => void save()} disabled={!input.trim() || saving} size="sm">
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
          {configured && (
            <Button variant="outline" size="sm" onClick={() => { setEditing(false); setInput("") }}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {/* Per install, like the Auto mode; off also skips the questions' tokens. Only with a key, like the pill. */}
      {configured && (
      <label className="flex items-center justify-between gap-4 pt-2 text-sm">
        <span>
          Suggest people to tag
          <span className="block text-xs text-muted-foreground">
            In Auto previews of a stream message, offer @mentions judged from recent messages here. Nothing is added until you click.
          </span>
        </span>
        <Switch checked={tagSuggestions} onCheckedChange={setTagSuggestionsEnabled} aria-label="Suggest people to tag" />
      </label>
      )}
    </div>
  )
}
