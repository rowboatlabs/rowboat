"use client"

import { useState, useEffect, useCallback } from "react"
import { Brain, CheckCircle2, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface MemorySettingsProps {
  dialogOpen: boolean
}

export function MemorySettings({ dialogOpen }: MemorySettingsProps) {
  const [configured, setConfigured] = useState(false)
  const [checking, setChecking] = useState(true)
  const [apiKey, setApiKey] = useState("")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null)

  const checkConfigured = useCallback(async () => {
    try {
      setChecking(true)
      const result = await window.ipc.invoke("supermemory:is-configured", null)
      setConfigured(result.configured)
    } catch {
      setConfigured(false)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (dialogOpen) checkConfigured()
  }, [dialogOpen, checkConfigured])

  const handleSave = async () => {
    const trimmed = apiKey.trim()
    if (!trimmed) return
    setSaving(true)
    setTestResult(null)
    try {
      const result = await window.ipc.invoke("supermemory:set-api-key", { apiKey: trimmed })
      if (result.success) {
        setConfigured(true)
        setApiKey("")
      }
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.ipc.invoke("supermemory:test-connection", null)
      setTestResult(result.success ? "success" : "error")
    } catch {
      setTestResult("error")
    } finally {
      setTesting(false)
    }
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-violet-500/10">
          <Brain className="size-5 text-violet-500" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">Supermemory</h3>
          <p className="text-xs text-muted-foreground">
            Persistent memory across conversations
          </p>
        </div>
      </div>

      {configured ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            API key configured
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
              Test Connection
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setConfigured(false)
                setTestResult(null)
              }}
            >
              Change Key
            </Button>
          </div>
          {testResult === "success" && (
            <p className="text-xs text-green-600">Connection successful</p>
          )}
          {testResult === "error" && (
            <p className="text-xs text-red-500">Connection failed — check your API key</p>
          )}

          <div className="rounded-lg border p-4 space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">How it works</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              When Supermemory is connected, your conversations are stored as memories. Before each response, relevant memories are fetched to give the AI persistent context about you across sessions.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Enter your Supermemory API key to enable persistent memory across conversations.
            Get your key from{" "}
            <a
              href="https://console.supermemory.ai/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              console.supermemory.ai
            </a>
          </p>
          <div className="flex gap-2">
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your Supermemory API key"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className="flex-1"
            />
            <Button
              onClick={handleSave}
              disabled={!apiKey.trim() || saving}
              size="sm"
            >
              {saving ? <Loader2 className="size-4 animate-spin mr-1" /> : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
