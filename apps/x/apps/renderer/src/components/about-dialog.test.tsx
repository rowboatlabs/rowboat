import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ipc as ipcShared } from "@x/shared"
import { AboutDialog } from "./about-dialog"

type UpdaterStatus = ipcShared.IPCChannels["updater:status"]["req"]

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
;(Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false

let updaterStatus: UpdaterStatus
let invokeCalls: string[]
let updaterListener: ((status: UpdaterStatus) => void) | null
const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined)

;(window as unknown as { ipc: unknown }).ipc = {
  send: () => undefined,
  on: (channel: string, handler: (status: UpdaterStatus) => void) => {
    if (channel === "updater:status") updaterListener = handler
    return () => {
      updaterListener = null
    }
  },
  invoke: async (channel: string) => {
    invokeCalls.push(channel)
    if (channel === "updater:getStatus" || channel === "updater:check") return updaterStatus
    if (channel === "app:getVersions") {
      return { electron: "39.2.7", chrome: "142.0.0.0", node: "22.0.0" }
    }
    if (channel === "updater:quitAndInstall") return {}
    throw new Error(`no handler: ${channel}`)
  },
}

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText },
})

beforeEach(() => {
  updaterStatus = { state: "idle", version: "1.2.3", lastCheckedAt: Date.now() }
  invokeCalls = []
  updaterListener = null
  writeText.mockClear()
})

afterEach(() => {
  cleanup()
})

describe("AboutDialog", () => {
  it("shows product identity, versions, and live update status", async () => {
    render(<AboutDialog open onOpenChange={() => undefined} />)

    expect(screen.getByRole("heading", { name: "Rowboat" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Rowboat logo" })).toHaveAttribute("src", "./logo-only.png")
    expect(screen.getByText(/remembers the work/i)).toBeInTheDocument()
    expect(await screen.findByText("You’re up to date")).toBeInTheDocument()
    expect(screen.getByText("Version 1.2.3 · Desktop")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Technical details"))
    expect(await screen.findByText("39.2.7")).toBeInTheDocument()

    act(() => updaterListener?.({ state: "checking", version: "1.2.3" }))
    expect(await screen.findByText("Checking for updates")).toBeInTheDocument()
  })

  it("checks for updates and copies diagnostics", async () => {
    render(<AboutDialog open onOpenChange={() => undefined} />)
    await screen.findByText("You’re up to date")

    fireEvent.click(screen.getByRole("button", { name: "Check again" }))
    await waitFor(() => expect(invokeCalls).toContain("updater:check"))

    fireEvent.click(screen.getByText("Technical details"))
    fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain("Rowboat 1.2.3")
    expect(writeText.mock.calls[0][0]).toContain("Electron 39.2.7")
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument()
  })

  it("offers the installed update restart action", async () => {
    updaterStatus = { state: "ready", version: "1.2.3", newVersion: "1.3.0" }
    render(<AboutDialog open onOpenChange={() => undefined} />)

    expect(await screen.findByText("Rowboat 1.3.0 is ready to install.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Restart" }))
    await waitFor(() => expect(invokeCalls).toContain("updater:quitAndInstall"))
  })
})
