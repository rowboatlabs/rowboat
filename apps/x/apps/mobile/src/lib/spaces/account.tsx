import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearSpacesCache } from '@/lib/spaces/cache';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { danceForTokens, discoverIssuer, refreshTokens, type SpacesTokens } from './oauth';
import { registerWithHarbor, unregisterFromHarbor } from '@/lib/push';
import { SpacesClient } from './client';

// Spaces account state: ONE sign-in against the server's AS (discovered from
// the server), tokens in the keychain. One server since 2026-11-09 (harbor
// spec §4): the account is a member of it on first contact (POST /v1/me),
// and `orgs` — the name the screens kept — holds that one record or none.

/** The Spaces server. Overridable for local Harbor dev (EXPO_PUBLIC_SPACES_APEX, its earlier name, still works). */
export const SERVER_URL = process.env.EXPO_PUBLIC_SPACES_SERVER ?? process.env.EXPO_PUBLIC_SPACES_APEX ?? 'https://spaces.x.rowboatlabs.com';

/** Rowboat account API (rowboatx-backend) — owns the user record and billing. */
export const ACCOUNT_API_URL = process.env.EXPO_PUBLIC_ACCOUNT_API ?? 'https://api.x.rowboatlabs.com';

const ACCOUNT_KEY = 'rowboat.spaces.account.v1';
/** The last-seen server record — painted instantly on launch, refreshed in the background. */
const ORGS_CACHE_KEY = 'rowboat.spaces.server.v1';

/** The server, as the screens know it (the type kept its many-org name). */
export interface SpacesOrg {
  /** Always 'server'. */
  id: string;
  name: string;
  /** host, e.g. spaces.x.rowboatlabs.com */
  address: string;
  memberId: string;
  displayName: string;
}

interface StoredAccount {
  issuer: string;
  clientId: string;
  tokens: SpacesTokens;
}

export type SpacesAccountStatus = 'loading' | 'signedOut' | 'signedIn';

interface SpacesAccount {
  status: SpacesAccountStatus;
  /** null until the first fetch answers — render a spinner, not an empty state. */
  orgs: SpacesOrg[] | null;
  orgsError: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Request account deletion (App Store 5.1.1(v)), then sign out locally.
   * Resolves to the date the account is gone by. Throws with a readable
   * message when a server refuses.
   */
  deleteAccount: () => Promise<{ deleteBy: string }>;
  refreshOrgs: () => Promise<void>;
  /** Fresh bearer for Harbor calls (auto-refreshes near expiry). */
  getAccessToken: (opts?: { forceRefresh?: boolean }) => Promise<string>;
}

const Ctx = createContext<SpacesAccount | null>(null);

export function SpacesAccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SpacesAccountStatus>('loading');
  const [orgs, setOrgs] = useState<SpacesOrg[] | null>(null);
  const [orgsError, setOrgsError] = useState<string | null>(null);
  const accountRef = useRef<StoredAccount | null>(null);

  useEffect(() => {
    void (async () => {
      const raw = await SecureStore.getItemAsync(ACCOUNT_KEY).catch(() => null);
      if (raw) {
        accountRef.current = JSON.parse(raw) as StoredAccount;
        // Paint the cached orgs immediately; refreshOrgs replaces them.
        const cached = await AsyncStorage.getItem(ORGS_CACHE_KEY).catch(() => null);
        if (cached) setOrgs((prev) => prev ?? (JSON.parse(cached) as SpacesOrg[]));
        setStatus('signedIn');
      } else {
        setStatus('signedOut');
      }
    })();
  }, []);

  const persist = useCallback(async (account: StoredAccount | null) => {
    accountRef.current = account;
    if (account) await SecureStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(account));
    else await SecureStore.deleteItemAsync(ACCOUNT_KEY).catch(() => {});
  }, []);

  const getAccessToken = useCallback(async (opts?: { forceRefresh?: boolean }): Promise<string> => {
    const account = accountRef.current;
    if (!account) throw new Error('not signed in');
    const nearExpiry = account.tokens.expiresAt - Date.now() < 60_000;
    if (!opts?.forceRefresh && !nearExpiry) return account.tokens.access;
    const tokens = await refreshTokens(account.issuer, account.clientId, account.tokens.refresh);
    await persist({ ...account, tokens });
    return tokens.access;
  }, [persist]);

  const refreshOrgs = useCallback(async () => {
    if (!accountRef.current) return;
    setOrgsError(null);
    try {
      const client = new SpacesClient({ baseUrl: SERVER_URL, token: (opts) => getAccessToken(opts) });
      const [health, { member }] = await Promise.all([client.health(), client.enroll()]);
      const record: SpacesOrg[] = [{ id: 'server', name: health.server.name, address: new URL(SERVER_URL).host, memberId: member.id, displayName: member.displayName }];
      setOrgs(record);
      void AsyncStorage.setItem(ORGS_CACHE_KEY, JSON.stringify(record)).catch(() => {});
      // Harbor is the push sender (PUSH_PLAN.md) — re-register on every
      // refresh: idempotent, and it keeps token + level current.
      void registerWithHarbor(record, getAccessToken).catch(() => {});
    } catch (err) {
      setOrgsError(err instanceof Error ? err.message : String(err));
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (status === 'signedIn') void refreshOrgs();
  }, [status, refreshOrgs]);

  const signIn = useCallback(async () => {
    const issuer = await discoverIssuer(SERVER_URL);
    if (!issuer) throw new Error('the Spaces server names no authorization server');
    const result = await danceForTokens(issuer);
    await persist(result);
    setStatus('signedIn');
  }, [persist]);

  const signOut = useCallback(async () => {
    // Forget this device's push token BEFORE the tokens go — otherwise the
    // phone keeps buzzing for an account it no longer shows.
    if (orgs?.length) await unregisterFromHarbor(orgs, getAccessToken).catch(() => {});
    await persist(null);
    void AsyncStorage.removeItem(ORGS_CACHE_KEY).catch(() => {});
    void clearSpacesCache();
    setOrgs(null);
    setOrgsError(null);
    setStatus('signedOut');
  }, [persist, orgs, getAccessToken]);

  // Account deletion, minimal v1 (2026-10-08, revised 2026-10-13; one server
  // since 2026-11-09). Two calls, Spaces first while the login still works:
  // the server deactivates you (out of every space, your agents with you,
  // name kept on what you wrote, push tokens gone), then rowboatx-backend
  // bans the login, records the request and emails the date. The account and
  // its data are deleted by hand before that date. Both calls are idempotent,
  // so a retry after a failure is safe.
  const deleteAccount = useCallback(async () => {
    const token = await getAccessToken();
    const headers = { authorization: `Bearer ${token}` };
    const spaces = await fetch(`${SERVER_URL}/v1/me`, { method: 'DELETE', headers });
    if (!spaces.ok) throw new Error(`Couldn't remove you from Spaces (${spaces.status}). Please try again.`);
    const res = await fetch(`${ACCOUNT_API_URL}/v1/account`, { method: 'DELETE', headers });
    if (res.status === 404) throw new Error("Account deletion isn't available yet. Please try again later.");
    if (!res.ok) {
      const detail = await res.json().then((j: { message?: string; error?: string }) => j.message ?? j.error).catch(() => undefined);
      throw new Error(detail ?? `Couldn't delete your account (${res.status}). Please try again.`);
    }
    const { deleteBy } = (await res.json()) as { deleteBy: string };
    await signOut();
    return { deleteBy };
  }, [getAccessToken, signOut]);

  const value = useMemo(
    () => ({ status, orgs, orgsError, signIn, signOut, deleteAccount, refreshOrgs, getAccessToken }),
    [status, orgs, orgsError, signIn, signOut, deleteAccount, refreshOrgs, getAccessToken],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSpacesAccount(): SpacesAccount {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSpacesAccount outside SpacesAccountProvider');
  return ctx;
}
