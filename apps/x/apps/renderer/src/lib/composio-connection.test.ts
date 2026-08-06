import { describe, expect, it } from "vitest"
import { waitForComposioConnection } from "./composio-connection"

function virtualClock() {
  let time = 0
  return {
    now: () => time,
    wait: async (ms: number) => { time += ms },
  }
}

describe("waitForComposioConnection", () => {
  it("recovers when the completion event was missed but persisted state is active", async () => {
    const statuses = [
      { isConnected: false, status: "INITIATED" },
      { isConnected: true, status: "ACTIVE" },
    ]
    const clock = virtualClock()

    const result = await waitForComposioConnection({
      readStatus: async () => statuses.shift() ?? { isConnected: false },
      isCurrent: () => true,
      timeoutMs: 5_000,
      pollIntervalMs: 1_000,
      ...clock,
    })

    expect(result).toEqual({ state: "connected" })
  })

  it("settles terminal provider failures", async () => {
    const clock = virtualClock()
    const result = await waitForComposioConnection({
      readStatus: async () => ({ isConnected: false, status: "EXPIRED" }),
      isCurrent: () => true,
      ...clock,
    })

    expect(result).toEqual({ state: "failed", status: "EXPIRED" })
  })

  it("ignores transient status read errors and retries", async () => {
    let calls = 0
    const clock = virtualClock()
    const result = await waitForComposioConnection({
      readStatus: async () => {
        calls += 1
        if (calls === 1) throw new Error("renderer reloading")
        return { isConnected: true, status: "ACTIVE" }
      },
      isCurrent: () => true,
      timeoutMs: 5_000,
      pollIntervalMs: 1_000,
      ...clock,
    })

    expect(result).toEqual({ state: "connected" })
    expect(calls).toBe(2)
  })

  it("cancels superseded attempts without changing the newer flow", async () => {
    let current = true
    const clock = virtualClock()
    const result = await waitForComposioConnection({
      readStatus: async () => {
        current = false
        return { isConnected: false, status: "INITIATED" }
      },
      isCurrent: () => current,
      ...clock,
    })

    expect(result).toEqual({ state: "cancelled" })
  })

  it("times out abandoned initiated flows", async () => {
    const clock = virtualClock()
    const result = await waitForComposioConnection({
      readStatus: async () => ({ isConnected: false, status: "INITIATED" }),
      isCurrent: () => true,
      timeoutMs: 2_000,
      pollIntervalMs: 1_000,
      ...clock,
    })

    expect(result).toEqual({ state: "timeout" })
  })
})
