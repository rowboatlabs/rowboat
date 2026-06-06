# Restoring the "Sign in to Rowboat" Button

> **Status:** Reference doc. Captured from the codebase before the button was removed in PR #3. Use this to restore the sign-in CTA if needed.

## What was removed

PR #3 (`remove-sign-in-to-rowboat-button`) deleted the following from `apps/x/apps/renderer/src/components/sidebar-content.tsx`:

1. The button JSX block (rendered when `!isRowboatConnected`)
2. The `handleRowboatLogin` `useCallback`
3. The `loggingIn` / `setLoggingIn` state
4. The `setLoggingIn(false)` call inside the `oauth:didConnect` listener
5. The `useCallback` import (now unused)

## How to restore

### 1. Re-add the import

In `apps/x/apps/renderer/src/components/sidebar-content.tsx`, line 4:

```ts
import { useCallback, useEffect, useRef, useState } from "react"
```

### 2. Re-add the state

After `const [isRowboatConnected, setIsRowboatConnected] = useState(false)` (around line 439):

```tsx
const [isRowboatConnected, setIsRowboatConnected] = useState(false)
const [loggingIn, setLoggingIn] = useState(false)
const [appUrl, setAppUrl] = useState<string | null>(null)
```

### 3. Re-add the `handleRowboatLogin` callback

Just before the `useEffect` that calls `refreshOauthError` (originally around line 635):

```tsx
const handleRowboatLogin = useCallback(async () => {
  try {
    setLoggingIn(true)
    const result = await window.ipc.invoke('oauth:connect', { provider: 'rowboat' })
    if (!result.success) {
      setLoggingIn(false)
    }
  } catch {
    setLoggingIn(false)
  }
}, [])
```

### 4. Re-add `setLoggingIn(false)` to the `oauth:didConnect` listener

In the `useEffect` for `refreshOauthError`:

```tsx
const cleanup = window.ipc.on('oauth:didConnect', () => {
  refreshOauthError()
  setLoggingIn(false)  // <-- re-add this line
})
```

### 5. Re-add the button JSX

Inside the `SidebarContentPanel` return, between the billing CTA block and the `{/* Bottom actions */}` block (originally around line 962):

```tsx
{/* Sign in CTA */}
{!isRowboatConnected && (
  <div className="px-3 py-2">
    <button
      onClick={handleRowboatLogin}
      disabled={loggingIn}
      className="flex w-full items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/20 px-3 py-2.5 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/40 disabled:opacity-50"
    >
      {loggingIn ? 'Signing in…' : 'Sign in to Rowboat'}
    </button>
  </div>
)}
```

### 6. Verify

Run from `apps/x/apps/renderer/`:

```bash
npx tsc --noEmit
```

## Underlying OAuth wiring (for context)

The button calls `window.ipc.invoke('oauth:connect', { provider: 'rowboat' })`. The main-process flow lives in `apps/x/apps/main/src/oauth-handler.ts` and is unchanged by PR #3 — only the UI entry point was removed.

Provider config (Supabase Auth as the upstream identity provider) lives in `apps/x/packages/core/src/auth/providers.ts`.
