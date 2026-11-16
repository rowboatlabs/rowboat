// Where the browser build points, set per deployment at build time.
//
// VITE_SPACES_SERVER_URL: the Spaces server (one since 2026-11-09), which
//   names the sign-in provider and holds the signed-in person's chats.
//   Production by default. VITE_SPACES_APEX_URL, its earlier name, still works.
// VITE_SPACES_DEV_HARBOR (+ VITE_SPACES_DEV_MEMBER): a local `pnpm dev` Harbor
//   with dev tokens instead, so the web app runs against it with no sign-in.
// VITE_ROWBOAT_ACCOUNT_URL: the Rowboat account app (rowboatx-backend's
//   `appUrl`), where a person sees their plan and credits. Production by default.

const env = import.meta.env as Record<string, string | undefined>

export const SERVER_URL = (env.VITE_SPACES_SERVER_URL ?? env.VITE_SPACES_APEX_URL ?? 'https://spaces.x.rowboatlabs.com').replace(/\/$/, '')
export const DEV_HARBOR = env.VITE_SPACES_DEV_HARBOR?.replace(/\/$/, '')
export const DEV_MEMBER = env.VITE_SPACES_DEV_MEMBER ?? 'ramnique'
export const ACCOUNT_URL = (env.VITE_ROWBOAT_ACCOUNT_URL ?? 'https://app.x.rowboatlabs.com').replace(/\/$/, '')
