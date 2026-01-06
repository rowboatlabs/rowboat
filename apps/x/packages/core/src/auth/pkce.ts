import { randomBytes, createHash } from 'crypto';

/**
 * Generate a random code verifier for PKCE
 * Returns a base64url-encoded string of 128 characters
 */
export function generateCodeVerifier(): string {
  // Generate 96 random bytes (768 bits) to ensure we have enough entropy
  // After base64url encoding, this will be 128 characters
  const bytes = randomBytes(96);
  return base64UrlEncode(bytes);
}

/**
 * Generate a code challenge from a code verifier
 * Uses SHA256 hash and base64url encoding
 */
export function generateCodeChallenge(verifier: string): string {
  const hash = createHash('sha256').update(verifier).digest();
  return base64UrlEncode(hash);
}

/**
 * Base64url encode (RFC 4648)
 * Replaces + with -, / with _, and removes padding
 */
function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

