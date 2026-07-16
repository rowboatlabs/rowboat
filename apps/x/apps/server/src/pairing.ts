import os from 'node:os';

// The QR shown in the desktop app encodes this JSON verbatim. The phone
// probes `urls` in order via authenticated GET /health and keeps the first
// that answers.
export interface PairingPayload {
  v: 1;
  name: string;
  urls: string[];
  token: string;
}

// Loopback always (simulator pairing); LAN/Tailscale addresses only when the
// user has explicitly opted in — exposing the API beyond the machine is a
// deliberate act, not a default.
export function collectPairingUrls(port: number, lanEnabled: boolean): string[] {
  const urls = [`http://127.0.0.1:${port}`];
  if (!lanEnabled) return urls;
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      urls.push(`http://${info.address}:${port}`);
    }
  }
  return urls;
}

export function buildPairingPayload(port: number, lanEnabled: boolean, token: string): PairingPayload {
  return {
    v: 1,
    name: os.hostname(),
    urls: collectPairingUrls(port, lanEnabled),
    token,
  };
}
