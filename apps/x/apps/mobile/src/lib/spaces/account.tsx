import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { danceForTokens, discoverIssuer, refreshTokens, type SpacesTokens } from './oauth';

// Spaces account state: ONE sign-in against the deployment's AS (discovered
// from the apex), tokens in the keychain, orgs from apex GET /v1/orgs.
// Tokens are realm-generic — the same access token works at every org.

/** The hosted deployment. Overridable for local Harbor dev. */
export const APEX_URL = process.env.EXPO_PUBLIC_SPACES_APEX ?? 'https://spaces.x.rowboatlabs.com';

const ACCOUNT_KEY = 'rowboat.spaces.account.v1';

export interface SpacesOrg {
  id: string;
  name: string;
  /** host, e.g. rowboat.spaces.x.rowboatlabs.com */
  address: string;
  memberId: string;
  displayName: string;
  role: string;
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
      const token = await getAccessToken();
      const res = await fetch(`${APEX_URL}/v1/orgs`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`org list failed (${res.status})`);
      const json = (await res.json()) as { orgs: SpacesOrg[] };
      setOrgs(json.orgs);
    } catch (err) {
      setOrgsError(err instanceof Error ? err.message : String(err));
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (status === 'signedIn') void refreshOrgs();
  }, [status, refreshOrgs]);

  const signIn = useCallback(async () => {
    const issuer = await discoverIssuer(APEX_URL);
    if (!issuer) throw new Error('the Spaces server names no authorization server');
    const result = await danceForTokens(issuer);
    await persist(result);
    setStatus('signedIn');
  }, [persist]);

  const signOut = useCallback(async () => {
    await persist(null);
    setOrgs(null);
    setOrgsError(null);
    setStatus('signedOut');
  }, [persist]);

  const value = useMemo(
    () => ({ status, orgs, orgsError, signIn, signOut, refreshOrgs, getAccessToken }),
    [status, orgs, orgsError, signIn, signOut, refreshOrgs, getAccessToken],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSpacesAccount(): SpacesAccount {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSpacesAccount outside SpacesAccountProvider');
  return ctx;
}
