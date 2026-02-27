# Rowboat X — Auth, Model Switching & Quota Improvements

## All Fixes Complete ✅

### 1. ✅ Fix Anthropic Login (Port conflict + state validation)
**File:** `apps/x/apps/main/src/oauth-device-handler.ts`
- Moved Anthropic OAuth to dedicated port **8081** (was sharing 8080 with generic OAuth handler)
- Added robust state validation that handles empty/missing state gracefully
- Added code validation (checks for missing authorization code)
- Added `.catch()` handler for auth server startup failures (e.g. port in use)
- Added comprehensive logging throughout the flow
- Improved error messages with specific failure descriptions

### 2. ✅ Fix Antigravity Login (Callback path mismatch bug)
**File:** `apps/x/apps/main/src/oauth-device-handler.ts`
- Fixed callback path from `/oauth-callback` to `/oauth/callback` to match `auth-server.ts`
- Added same robustness improvements as Anthropic (code validation, `.catch()`, logging)
- Dedicated port 51121 preserved

### 3. ✅ Fast Model Switching (Skip test for OAuth providers)
**File:** `apps/x/apps/renderer/src/components/model-selector.tsx`
- OAuth-connected providers skip the `models:test` call entirely → instant switching
- API-key-only or unconnected providers still test before switching
- Added loading spinner per-model during switch

### 4. ✅ Connection Status in Model Selector
**Files:**
- `apps/x/apps/renderer/src/hooks/useOAuthState.ts` (NEW)
- `apps/x/apps/renderer/src/components/model-selector.tsx`
- Green/red dot per provider in the dropdown header
- Green/red dot next to the trigger button showing current provider status
- "Not connected" warning text for unconnected OAuth providers
- Dimmed (opacity) models from unconnected providers

### 5. ✅ Status Bar (Active model + provider + connection + quota)
**Files:**
- `apps/x/apps/renderer/src/components/status-bar.tsx` (NEW)
- `apps/x/apps/renderer/src/App.tsx`
- Persistent status bar at bottom of app window
- Shows: model name, provider color, connection dot, auth type (OAuth/API Key), quota tier
- Click model area → popover with detailed quota info and usage breakdown
- Right-aligned session usage counter (token count + request count)

### 6. ✅ Usage & Quota Tracking
**Files:**
- `apps/x/apps/renderer/src/hooks/useUsageTracking.ts` (NEW)
- `apps/x/apps/renderer/src/App.tsx` (wired `modelUsage` state to dispatch events)
- Tracks: input tokens, output tokens, total tokens, request count, session duration
- Quota info for all providers: tier name, rate limits, daily limits
- Special Antigravity daily quota progress bar
- Usage events dispatched from existing `LlmStepStreamFinishStepEvent` handler

### 7. ✅ OAuth Event Mapping Bug Fix
**Files:**
- `apps/x/apps/renderer/src/components/settings-dialog.tsx`
- `apps/x/apps/renderer/src/components/onboarding-modal.tsx`
- Fixed `anthropic-native` → `anthropic` mapping in OAuth event listeners
- Without this fix, the UI never reacted to successful Anthropic auth events

## Files Modified (8 total)
1. `apps/x/apps/main/src/oauth-device-handler.ts` - Auth flow fixes
2. `apps/x/apps/renderer/src/components/model-selector.tsx` - Rewrote with connection status
3. `apps/x/apps/renderer/src/components/settings-dialog.tsx` - OAuth event mapping fix
4. `apps/x/apps/renderer/src/components/onboarding-modal.tsx` - OAuth event mapping fix
5. `apps/x/apps/renderer/src/App.tsx` - Status bar integration + usage event wiring

## Files Created (4 total)
6. `apps/x/apps/renderer/src/hooks/useOAuthState.ts` - OAuth connection state hook
7. `apps/x/apps/renderer/src/hooks/useUsageTracking.ts` - Token usage tracking hook
8. `apps/x/apps/renderer/src/components/status-bar.tsx` - Status bar component
