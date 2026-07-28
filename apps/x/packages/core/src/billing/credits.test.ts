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

// the activation catalog as served by GET /v1/config — display metadata is
// backend-owned; the app only knows the codes
const ACTIVATIONS = [
  { code: "first_gmail_connected", displayName: "Connected Gmail", description: "Link your Google account", credits: 100 },
  { code: "first_email_sent", displayName: "First email sent", credits: 100 },
  { code: "first_bg_agent", displayName: "First background agent", credits: 100 },
  { code: "first_app_built", displayName: "First app built", credits: 100 },
  { code: "some_future_code", displayName: "Unknown to this app version", credits: 100 },
];

function mockBilling(planId: string | null) {
  vi.doMock("./billing.js", () => ({
    getBillingInfo: vi.fn(async () => ({ subscriptionPlanId: planId, catalog: CATALOG })),
  }));
}

// pass null to omit the creditActivations field entirely (pre-catalog API)
function mockConfig(creditActivations: unknown[] | null = ACTIVATIONS) {
  vi.doMock("../config/rowboat.js", () => ({
    getRowboatConfig: vi.fn(async () => ({
      appUrl: "https://app.example",
      websocketApiUrl: "",
      supabaseUrl: "",
      billing: CATALOG,
      ...(creditActivations ? { creditActivations } : {}),
    })),
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
  mockConfig();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete process.env.ROWBOAT_WORKDIR;
  delete process.env.ROWBOAT_CREDITS;
  vi.doUnmock("../account/account.js");
  vi.doUnmock("../auth/tokens.js");
  vi.doUnmock("./billing.js");
  vi.doUnmock("../config/rowboat.js");
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
    // display name comes from the API catalog, not app code
    expect(first).toMatchObject({ code: "first_email_sent", title: "First email sent", credits: 100 });
    expect(seen).toHaveLength(1);

    // second attempt short-circuits on the local claim — no network call
    const second = await credits.maybeActivateCredit("first_email_sent");
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const state = await credits.getCreditsState();
    expect(state.activities.find((a) => a.code === "first_email_sent")?.claimed).toBe(true);
    expect(state.activities.find((a) => a.code === "first_bg_agent")?.claimed).toBe(false);
    // catalog codes this app version doesn't know are dropped
    expect(state.activities.map((a) => a.code)).not.toContain("some_future_code");
  });

  it("shows no activities when the API serves no reward catalog", async () => {
    mockConfig(null);
    const credits = await loadCredits();
    const state = await credits.getCreditsState();
    expect(state.eligible).toBe(true);
    expect(state.activities).toEqual([]);
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

const REFERRAL_STATUS = {
  code: "ABC-DEF-GHJ",
  claimsUsed: 1,
  maxClaims: 3,
  referrerCredits: 500,
  refereeCredits: 500,
};

// route fetches by URL: GET /v1/referral -> status, POST /v1/referral/claims -> claim
function mockReferralApi(claim: () => Response, status: () => Response = () => new Response(JSON.stringify(REFERRAL_STATUS), { status: 200 })) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/v1/referral")) return status();
    if (String(url).endsWith("/v1/referral/claims") && init?.method === "POST") return claim();
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("referrals", () => {
  it("includes the referral status in state", async () => {
    mockReferralApi(() => new Response(null, { status: 500 }));
    const credits = await loadCredits();
    const state = await credits.getCreditsState();
    expect(state.referral).toEqual({ ...REFERRAL_STATUS, claimedByMe: false });
  });

  it("omits referral when the status fetch fails", async () => {
    mockReferralApi(
      () => new Response(null, { status: 500 }),
      () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );
    const credits = await loadCredits();
    const state = await credits.getCreditsState();
    expect(state.eligible).toBe(true);
    expect(state.referral).toBeUndefined();
  });

  it("claims an invite code once, notifies, and marks the account", async () => {
    mockReferralApi(() => new Response(JSON.stringify({ creditsGranted: 500 }), { status: 200 }));
    const credits = await loadCredits();
    const seen: unknown[] = [];
    credits.subscribeCreditActivations((event) => seen.push(event));

    const result = await credits.claimReferralCode(" abc-def-ghj ");
    expect(result).toEqual({ ok: true, creditsGranted: 500 });
    expect(seen).toEqual([{ code: "referral_claimed", title: "Invite code applied", credits: 500 }]);

    const state = await credits.getCreditsState();
    expect(state.referral?.claimedByMe).toBe(true);

    // a second attempt is refused locally, without a network call
    const fetchCalls = fetchMock.mock.calls.length;
    const second = await credits.claimReferralCode("XYZ-XYZ-XYZ");
    expect(second.ok).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(fetchCalls);
  });

  it("surfaces backend claim errors and stays retryable", async () => {
    mockReferralApi(() => new Response(JSON.stringify({ error: "Unknown referral code" }), { status: 404 }));
    const credits = await loadCredits();

    const bad = await credits.claimReferralCode("BAD-BAD-BAD");
    expect(bad).toEqual({ ok: false, message: "Unknown referral code" });

    // rejected claims don't mark the account — a valid code still works
    mockReferralApi(() => new Response(JSON.stringify({ creditsGranted: 500 }), { status: 200 }));
    expect((await credits.claimReferralCode("ABC-DEF-GHJ")).ok).toBe(true);
  });

  it("marks the account claimed on a definitive already-claimed answer", async () => {
    mockReferralApi(() =>
      new Response(JSON.stringify({ error: "This account has already claimed a referral code" }), { status: 409 }),
    );
    const credits = await loadCredits();

    const result = await credits.claimReferralCode("ABC-DEF-GHJ");
    expect(result.ok).toBe(false);
    const state = await credits.getCreditsState();
    expect(state.referral?.claimedByMe).toBe(true);
  });
});
