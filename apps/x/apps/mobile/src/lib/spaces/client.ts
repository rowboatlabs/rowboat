import * as Crypto from 'expo-crypto';
import { SpacesClient as SharedSpacesClient, type SpacesClientOptions } from '@x/spaces-client';

// The shared Harbor client (@x/spaces-client, 2026-10-09; this file was a
// copy of it until then) with the phone's SHA-256: React Native has no
// WebCrypto, so blob hashes come from expo-crypto.

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class SpacesClient extends SharedSpacesClient {
  constructor(options: SpacesClientOptions) {
    super({ sha256Hex, ...options });
  }
}
