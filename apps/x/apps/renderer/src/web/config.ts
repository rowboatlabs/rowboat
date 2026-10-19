// Where the browser build points, set per deployment at build time.
//
// VITE_SPACES_APEX_URL: the Spaces deployment's apex, which names the sign-in
//   provider and lists the signed-in person's orgs. Production by default.
// VITE_SPACES_DEV_HARBOR (+ VITE_SPACES_DEV_MEMBER): a local `pnpm dev` Harbor
//   with dev tokens instead, so the web app runs against it with no sign-in.

const env = import.meta.env as Record<string, string | undefined>

export const APEX_URL = (env.VITE_SPACES_APEX_URL ?? 'https://spaces.x.rowboatlabs.com').replace(/\/$/, '')
export const DEV_HARBOR = env.VITE_SPACES_DEV_HARBOR?.replace(/\/$/, '')
export const DEV_MEMBER = env.VITE_SPACES_DEV_MEMBER ?? 'ramnique'

/** The apex host org addresses hang off: `<slug>.<APEX_HOST>`. */
export const APEX_HOST = new URL(APEX_URL).host
