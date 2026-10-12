# Spaces on the web

The renderer's Spaces section also builds as a standalone web app (2026-10-09): `web.html` → `src/web/main.tsx`, served from a domain instead of `app://`. It is the desktop's own components; only the host underneath differs.

## How it works

- **The same `window.ipc` contract, served in the tab.**
  - `src/web/host.ts` installs it before the app loads.
  - `src/web/handlers.ts` answers the Spaces channels. Every channel that is one Harbor call comes from the shared table in `@x/spaces-client` (`channels.ts`), the same one the desktop serves. The rest are the browser's own: sign-in, the org list, uploads from bytes.
  - Any other channel is refused by name, the way a failed IPC call already fails.
- **Talks to Harbor directly.** It calls each org's host cross-origin, which Harbor allows for the origins in `HARBOR_WEB_ORIGINS` (`apps/harbor/CONTRACT.md`).
- **Sign-in** is the phone's journey as a full-page redirect (`src/web/account.ts`): the apex names the authorization server, the browser registers itself once, PKCE carries the round trip. Tokens live in `localStorage`, and a refresh runs under a Web Lock so two tabs don't spend the same rotating refresh token.
- **The address bar is the navigation** (`src/web/routes.ts`): `/<org>/s/<space>`, `…/t/<thread>`, `…/a/<file>`, `/<org>/activity`.
- **No local runtime.** Nothing that needs the person's own machine is shown: `LOCAL_RUNTIME` in `lib/feature-flags.ts` is false here. That covers their Rowboat agent, scheduled sends and reminders, and voice.

## Run it

Against a local Harbor, with dev tokens and no sign-in. Harbor's dev binary already allows `http://localhost:5174`:

```sh
cd apps/harbor/packages/server && pnpm dev
cd apps/x/apps/renderer && VITE_SPACES_DEV_HARBOR=http://localhost:4272 pnpm dev:web   # http://localhost:5174
```

`VITE_SPACES_DEV_MEMBER` picks who you are (default `ramnique`).

Against a deployment, with real sign-in: set `VITE_SPACES_APEX_URL` (default production, `https://spaces.x.rowboatlabs.com`). That deployment's `HARBOR_WEB_ORIGINS` must list the page's origin.

## Ship it

- **Vercel.** The project's Root Directory is `apps/x/apps/renderer`. `vercel.json` there carries:
  - the install and build commands (Harbor's protocol package first, then the renderer's workspace dependencies)
  - the rewrite of every path to `web.html`
  - the Content Security Policy. Tokens sit in page storage, so no inline or foreign script may run, and `components/streamdown.tsx` sanitizes every Markdown it renders.
- **Environment:** `VITE_SPACES_APEX_URL` for the deployment it serves.
- **Harbor:** `HARBOR_WEB_ORIGINS` on that deployment lists the web app's origin.
