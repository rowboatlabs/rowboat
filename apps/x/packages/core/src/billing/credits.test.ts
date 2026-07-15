import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A JWT whose payload decodes to { sub: "user-1" } (signature irrelevant —
// the service only reads the sub claim as a local cache key).
function fakeJwt(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ sub }), "utf-8").toString("base64url");
  return `header.${payload}.sig`;
}

let tmpDir: string;
let fetchMock: ReturnType<typeof vi.fn>;

const CATALOG = {
  plans: [
    { id: "free-1", category: "free", displayName: "Free", monthlyCredits: 0, dailyCredits: 0, monthlyPriceCents: null },
    { id: "pro-1", category: "pro", displayName: "Pro", monthlyCredits: 0, dailyCredits: 0, monthlyPriceCents: 2000 },
  ],
};

function mockBilling(planId: string | null) {
  vi.doMock("./billing.js", () => ({
    getBillingInfo: vi.fn(async () => ({ subscriptionPlanId: planId, catalog: CATALOG })),
  }));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rowboat-credits-test-"));
  process.env.ROWBOAT_WORKDIR = tmpDir;
  // enable the feature flag via the dev override (no PostHog in tests)
  process.env.ROWBOAT_CREDITS = "1";
  vi.resetModules();
  vi.doMock("../account/account.js", () => ({
    isSignedIn: vi.fn(async () => true),
  }));
  vi.doMock("../auth/tokens.js", () => ({
    getAccessToken: vi.fn(async () => fakeJwt("user-1")),
  }));
  mockBilling("free-1");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete process.env.ROWBOAT_WORKDIR;
  delete process.env.ROWBOAT_CREDITS;
  vi.doUnmock("../account/account.js");
  vi.doUnmock("../auth/tokens.js");
  vi.doUnmock("./billing.js");
  vi.unstubAllGlobals();
  vi.resetModules();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function loadCredits() {
  return import("./credits.js");
}

function grantResponse(amount: number) {
  return new Response(JSON.stringify({ grant: { amount } }), { status: 200 });
}

describe("maybeActivateCredit", () => {
  it("activates once, notifies subscribers, and skips repeat attempts locally", async () => {
    const credits = await loadCredits();
    const seen: unknown[] = [];
    credits.subscribeCreditActivations((event) => seen.push(event));
    fetchMock.mockResolvedValueOnce(grantResponse(100));

    const first = await credits.maybeActivateCredit("first_email_sent");
    expect(first).toMatchObject({ code: "first_email_sent", credits: 100 });
    expect(seen).toHaveLength(1);

    // second attempt short-circuits on the local claim — no network call
    const second = await credits.maybeActivateCredit("first_email_sent");
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const state = await credits.getCreditsState();
    expect(state.activities.find((a) => a.code === "first_email_sent")?.claimed).toBe(true);
    expect(state.activities.find((a) => a.code === "first_bg_agent")?.claimed).toBe(false);
  });

  it("treats 409 as already claimed without notifying", async () => {
    const credits = await loadCredits();
    const seen: unknown[] = [];
    credits.subscribeCreditActivations((event) => seen.push(event));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Already activated" }), { status: 409 }));

    expect(await credits.maybeActivateCredit("first_gmail_connected")).toBeNull();
    expect(seen).toHaveLength(0);
    const state = await credits.getCreditsState();
    expect(state.activities.find((a) => a.code === "first_gmail_connected")?.claimed).toBe(true);
  });

  it("leaves the code unclaimed on 404/network failure so the next action retries", async () => {
    const credits = await loadCredits();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unknown activation code" }), { status: 404 }));
    expect(await credits.maybeActivateCredit("first_app_built")).toBeNull();

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await credits.maybeActivateCredit("first_app_built")).toBeNull();

    // both failures left it retryable — a later attempt succeeds
    fetchMock.mockResolvedValueOnce(grantResponse(100));
    expect(await credits.maybeActivateCredit("first_app_built")).toMatchObject({ credits: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("is enabled by default when no flag source is available", async () => {
    // no env override, no PostHog client in tests -> defaults on
    delete process.env.ROWBOAT_CREDITS;
    const credits = await loadCredits();
    const state = await credits.getCreditsState();
    expect(state.enabled).toBe(true);
  });

  it("does nothing when the feature flag is off", async () => {
    process.env.ROWBOAT_CREDITS = "0";
    const credits = await loadCredits();
    expect(await credits.maybeActivateCredit("first_email_sent")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    const state = await credits.getCreditsState();
    expect(state.enabled).toBe(false);
  });

  it("does nothing for paid plans — free tier only", async () => {
    mockBilling("pro-1");
    const credits = await loadCredits();
    expect(await credits.maybeActivateCredit("first_email_sent")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    const state = await credits.getCreditsState();
    expect(state.eligible).toBe(false);
  });

  it("does nothing when signed out", async () => {
    vi.doMock("../account/account.js", () => ({
      isSignedIn: vi.fn(async () => false),
    }));
    const credits = await loadCredits();
    expect(await credits.maybeActivateCredit("first_email_sent")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    const state = await credits.getCreditsState();
    expect(state.eligible).toBe(false);
    expect(state.activities.every((a) => !a.claimed)).toBe(true);
  });

  it("scopes claims to the signed-in user", async () => {
    const credits = await loadCredits();
    fetchMock.mockResolvedValueOnce(grantResponse(100));
    await credits.maybeActivateCredit("first_email_sent");

    // switch accounts: same install, different sub
    vi.doMock("../auth/tokens.js", () => ({
      getAccessToken: vi.fn(async () => fakeJwt("user-2")),
    }));
    vi.resetModules();
    const creditsUser2 = await loadCredits();
    const state = await creditsUser2.getCreditsState();
    expect(state.activities.find((a) => a.code === "first_email_sent")?.claimed).toBe(false);
  });
});
