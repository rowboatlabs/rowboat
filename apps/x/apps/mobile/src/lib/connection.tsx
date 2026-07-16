import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as analytics from './analytics';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import {
  createEventsClient,
  createRpcClient,
  createSessionsClient,
  type ConnectionStatus,
  type EventsClient,
  type RpcClient,
  type SessionsClient,
} from '@x/client';

// Pairing = the contents of the desktop QR (or manual entry): where the
// user's rowboat-server lives and the bearer key that opens it. Stored in the
// iOS keychain; the client singletons live for as long as the pairing does.

export interface Pairing {
  name?: string;
  url: string;
  token: string;
}

const STORE_KEY = 'rowboat.pairing.v1';

export interface QrPayload {
  v: 1;
  name?: string;
  urls: string[];
  token: string;
}

export function parseQrPayload(raw: string): QrPayload | null {
  try {
    const parsed = JSON.parse(raw) as QrPayload;
    if (parsed.v !== 1 || !Array.isArray(parsed.urls) || typeof parsed.token !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Probe candidate URLs with the token; first healthy one wins. */
export async function probeUrls(urls: string[], timeoutMs = 4000): Promise<string | null> {
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${url.replace(/\/+$/, '')}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return url.replace(/\/+$/, '');
    } catch {
      // try the next candidate
    }
  }
  return null;
}

interface ConnectionValue {
  /** undefined = still loading from the keychain; null = not paired. */
  pairing: Pairing | null | undefined;
  status: ConnectionStatus;
  rpc: RpcClient | null;
  events: EventsClient | null;
  sessions: SessionsClient | null;
  pair(pairing: Pairing): Promise<void>;
  unpair(): Promise<void>;
}

const ConnectionContext = createContext<ConnectionValue | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [pairing, setPairing] = useState<Pairing | null | undefined>(undefined);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const eventsRef = useRef<EventsClient | null>(null);

  useEffect(() => {
    void SecureStore.getItemAsync(STORE_KEY).then((raw) => {
      setPairing(raw ? (JSON.parse(raw) as Pairing) : null);
    });
  }, []);

  // Key rotation on the Mac invalidates this pairing permanently — drop it
  // and send the user back to the pairing screen instead of retrying forever.
  const handleUnauthorized = useCallback(() => {
    analytics.mobileUnpaired('unauthorized');
    void SecureStore.deleteItemAsync(STORE_KEY);
    setPairing(null);
    router.replace('/pairing');
  }, []);

  const clients = useMemo(() => {
    eventsRef.current?.close();
    eventsRef.current = null;
    if (!pairing) return { rpc: null, events: null, sessions: null };
    const rpc = createRpcClient({
      baseUrl: pairing.url,
      token: pairing.token,
      onUnauthorized: handleUnauthorized,
    });
    const events = createEventsClient({
      baseUrl: pairing.url,
      token: pairing.token,
      clientName: 'rowboat-ios',
      onUnauthorized: handleUnauthorized,
    });
    eventsRef.current = events;
    return { rpc, events, sessions: createSessionsClient(rpc) };
  }, [pairing, handleUnauthorized]);

  useEffect(() => {
    if (!clients.events) {
      setStatus('disconnected');
      return;
    }
    let wasDisconnected = false;
    const offStatus = clients.events.onStatus((next) => {
      if (next === 'connected' && wasDisconnected) analytics.mobileReconnected();
      if (next === 'disconnected') wasDisconnected = true;
      setStatus(next);
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') clients.events?.reconnectNow();
    });
    return () => {
      offStatus();
      sub.remove();
    };
  }, [clients.events]);

  useEffect(() => () => eventsRef.current?.close(), []);

  const pair = useCallback(async (next: Pairing) => {
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next));
    setPairing(next);
  }, []);

  const unpair = useCallback(async () => {
    await SecureStore.deleteItemAsync(STORE_KEY);
    setPairing(null);
  }, []);

  const value = useMemo<ConnectionValue>(
    () => ({ pairing, status, ...clients, pair, unpair }),
    [pairing, status, clients, pair, unpair],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): ConnectionValue {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error('useConnection must be used inside ConnectionProvider');
  return value;
}
