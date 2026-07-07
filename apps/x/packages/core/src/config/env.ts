export const API_URL =
  process.env.API_URL || 'https://api.x.rowboatlabs.com';

// GitHub OAuth app used for Apps publishing (device flow, public_repo scope).
// Client IDs are public identifiers, not secrets (spec §3).
export const GITHUB_OAUTH_CLIENT_ID =
  process.env.ROWBOAT_GITHUB_CLIENT_ID || 'Ov23liAka106zKEovj4B';
