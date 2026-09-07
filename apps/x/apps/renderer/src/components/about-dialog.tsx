import { useEffect, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, Loader2, RefreshCw } from "lucide-react"
import type { ipc as ipcShared } from "@x/shared"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

type UpdaterStatus = ipcShared.IPCChannels["updater:status"]["req"]
type Versions = ipcShared.IPCChannels["app:getVersions"]["res"]

const WEBSITE_URL = "https://www.rowboatlabs.com/"
const RELEASES_URL = "https://github.com/rowboatlabs/rowboat/releases"
const REPO_URL = "https://github.com/rowboatlabs/rowboat"
const SUPPORT_URL = "mailto:contact@rowboatlabs.com"

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function platformLabel(): string {
  const platform = navigator.platform || "Desktop"
  if (/mac/i.test(platform)) return "macOS"
  if (/win/i.test(platform)) return "Windows"
  if (/linux/i.test(platform)) return "Linux"
  return platform
}

function AboutUpdate({ status }: { status: UpdaterStatus | null }) {
  const checkNow = () => {
    void window.ipc.invoke("updater:check", null)
  }

  if (!status) {
    return (
      <div className="flex min-h-14 items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-3 py-2.5">
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Reading update status…</p>
      </div>
    )
  }

  if (status.state === "checking" || status.state === "downloading") {
    return (
      <div className="flex min-h-14 items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-3 py-2.5">
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">
            {status.state === "checking" ? "Checking for updates" : "Downloading update"}
          </p>
          <p className="text-xs text-muted-foreground">This usually takes only a moment.</p>
        </div>
      </div>
    )
  }

  if (status.state === "ready") {
    const version = status.newVersion?.replace(/^v/, "")
    return (
      <div className="flex min-h-14 items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-3 py-2.5">
        <span className="size-2.5 shrink-0 rounded-full bg-[var(--rowboat-attention)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Update ready</p>
          <p className="truncate text-xs text-muted-foreground">
            {version ? `Rowboat ${version} is ready to install.` : "A new version is ready to install."}
          </p>
        </div>
        <Button size="sm" className="shrink-0" onClick={() => void window.ipc.invoke("updater:quitAndInstall", null)}>
          Restart
        </Button>
      </div>
    )
  }

  if (status.state === "error") {
    return (
      <div className="flex min-h-14 items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-3 py-2.5">
        <AlertTriangle className="size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Couldn’t check for updates</p>
          <p className="truncate text-xs text-muted-foreground">{status.error ?? "Try again in a moment."}</p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={checkNow}>
          Try again
        </Button>
      </div>
    )
  }

  if (status.state === "disabled") {
    return (
      <div className="flex min-h-14 items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-3 py-2.5">
        <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
        <div>
          <p className="text-sm font-medium">Development build</p>
          <p className="text-xs text-muted-foreground">Automatic updates are disabled.</p>
        </div>
      </div>
    )
  }

  if (status.state === "unsupported") {
    return (
      <div className="flex min-h-14 items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-3 py-2.5">
        <RefreshCw className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Manual updates</p>
          <p className="truncate text-xs text-muted-foreground">Get the latest Rowboat release from GitHub.</p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => window.open(`${RELEASES_URL}/latest`, "_blank")}>
          Releases
        </Button>
      </div>
    )
  }

  const lastChecked = status.lastCheckedAt === undefined
    ? "Updates are checked automatically."
    : `Last checked ${new Date(status.lastCheckedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`

  return (
    <div className="flex min-h-14 items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-3 py-2.5">
      <CheckCircle2 className="size-4 shrink-0 text-[var(--rowboat-success)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">You’re up to date</p>
        <p className="truncate text-xs text-muted-foreground">{lastChecked}</p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={checkNow}>
        Check again
      </Button>
    </div>
  )
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const [status, setStatus] = useState<UpdaterStatus | null>(null)
  const [versions, setVersions] = useState<Versions | null>(null)
  const [copied, setCopied] = useState(false)
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.ipc.invoke("updater:getStatus", null).then((next) => {
      if (!cancelled) setStatus(next)
    })
    void window.ipc.invoke("app:getVersions", null).then((next) => {
      if (!cancelled) setVersions(next)
    })
    const unsubscribe = window.ipc.on("updater:status", setStatus)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [open])

  useEffect(() => () => {
    if (copyResetRef.current) clearTimeout(copyResetRef.current)
  }, [])

  const appVersion = status?.version || "—"
  const copyDiagnostics = async () => {
    const lines = [
      `Rowboat ${appVersion}`,
      versions?.electron ? `Electron ${versions.electron}` : null,
      versions?.chrome ? `Chromium ${versions.chrome}` : null,
      versions?.node ? `Node ${versions.node}` : null,
      `Platform ${platformLabel()}`,
    ].filter((line): line is string => Boolean(line))
    try {
      await navigator.clipboard.writeText(lines.join("\n"))
      setCopied(true)
      if (copyResetRef.current) clearTimeout(copyResetRef.current)
      copyResetRef.current = setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      console.error("Failed to copy diagnostics:", error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[540px]" aria-describedby="about-rowboat-description">
        <header className="grid justify-items-center px-8 pb-8 pt-10 text-center">
          <img src="./logo-only.png" alt="Rowboat logo" width={82} height={82} className="size-[82px] object-contain" />
          <DialogTitle className="mt-4 text-2xl font-semibold tracking-tight">
            Rowboat
          </DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">Version {appVersion} · Desktop</p>
          <DialogDescription id="about-rowboat-description" className="mt-3 max-w-[360px] text-sm leading-relaxed">
            Your AI coworker that remembers the work, not just the conversation.
          </DialogDescription>
        </header>

        <div className="px-7 pb-6">
          <AboutUpdate status={status} />

          <nav className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs font-medium" aria-label="About Rowboat links">
            <a className="text-muted-foreground transition-colors hover:text-foreground hover:underline hover:underline-offset-4" href={WEBSITE_URL} target="_blank" rel="noreferrer">Website</a>
            <a className="text-muted-foreground transition-colors hover:text-foreground hover:underline hover:underline-offset-4" href={RELEASES_URL} target="_blank" rel="noreferrer">Release notes</a>
            <a className="text-muted-foreground transition-colors hover:text-foreground hover:underline hover:underline-offset-4" href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a className="text-muted-foreground transition-colors hover:text-foreground hover:underline hover:underline-offset-4" href={SUPPORT_URL} target="_blank" rel="noreferrer">Support</a>
          </nav>

          <details className="group mt-4 border-y border-border/60">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-xs font-medium text-muted-foreground marker:hidden">
              Technical details
              <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 pb-3 text-xs">
              <dt className="text-muted-foreground">Rowboat</dt><dd>Version {appVersion}</dd>
              <dt className="text-muted-foreground">Electron</dt><dd>{versions?.electron ?? "—"}</dd>
              <dt className="text-muted-foreground">Chromium</dt><dd>{versions?.chrome ?? "—"}</dd>
              <dt className="text-muted-foreground">Node.js</dt><dd>{versions?.node ?? "—"}</dd>
              <dt className="text-muted-foreground">Platform</dt><dd>{platformLabel()}</dd>
            </dl>
            <Button size="sm" variant="outline" className="mb-3 gap-1.5" onClick={() => void copyDiagnostics()}>
              <Copy className="size-3.5" />
              {copied ? "Copied" : "Copy diagnostics"}
            </Button>
          </details>

          <p className="mt-4 text-center text-[0.7rem] text-muted-foreground">Made by Rowboat Labs · Apache 2.0</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
