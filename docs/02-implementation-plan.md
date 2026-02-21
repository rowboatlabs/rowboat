# Native ChatGPT & Anthropic OAuth Integration Plan

This plan details how we will modify the Rowboat repository to support native OAuth login flows for ChatGPT Plus and Claude Pro subscriptions. By porting reverse-engineered device/web OAuth flows directly into Rowboat, users will be able to utilize their existing AI subscriptions without needing a separate proxy application.

## Proposed Changes

### OAuth Backend Services (New)
We need to add a specialized OAuth service module inside Rowboat to handle the authentication dancing.

#### [NEW] src/application/lib/oauth/chatgpt.ts
- Create a local server hook or device auth polling loop that initiates the PKCE flow with `https://auth.openai.com`.
- Handle token exchange to receive the ChatGPT `access_token` and `refresh_token`.
- Extract the `chatgpt_account_id` if present.

#### [NEW] src/application/lib/oauth/anthropic.ts
- Implement the Anthropic OAuth device flow (or browser flow) mimicking the endpoints discovered in `opencode-anthropic-auth`.
- Handle token refresh and lifecycle management.

### AI SDK Provider Injection
We will update the backend files that initialize the AI agents and COPILOT to intercept requests to OpenAI/Anthropic and inject the OAuth Bearer token, rewriting the endpoint URL respectively.

#### [MODIFY] agents.ts (file:///Users/rubenmacedo/.gemini/antigravity/scratch/rowboat/apps/rowboat/src/application/lib/agents-runtime/agents.ts)
- Modify `createOpenAI/createAnthropic` initialization to check if an OAuth session exists.
- If OAuth is active, dynamically overwrite the provider's API URL (e.g. `https://chatgpt.com/backend-api/codex/responses`).
- Hook into the SDK's fetch interceptor to attach the `Authorization: Bearer <token>` and auto-refresh expired tokens.

#### [MODIFY] copilot.ts (file:///Users/rubenmacedo/.gemini/antigravity/scratch/rowboat/apps/rowboat/src/application/lib/copilot/copilot.ts)
- Similar to `agents.ts`, ensure Copilot uses the OAuth tokens for ChatGPT and Claude when configured.

### Settings UI (Frontend)
We need to update the Rowboat settings GUI to surface a "Login with ChatGPT Plus" and "Login with Claude Pro" button alongside the traditional API key input.

#### [MODIFY] onboarding-modal.tsx (file:///Users/rubenmacedo/.gemini/antigravity/scratch/rowboat/apps/x/apps/renderer/src/components/onboarding-modal.tsx)
- Add "Authenticate via User Subscription" buttons for ChatGPT and Anthropic.
- Trigger the native IPC handlers to open the auth browser windows or display device codes.

#### [MODIFY] settings-dialog.tsx (file:///Users/rubenmacedo/.gemini/antigravity/scratch/rowboat/apps/x/apps/renderer/src/components/settings-dialog.tsx)
- Add the same "Sign in" buttons to the main settings panel for managing AI Providers.
- Show current session expiration or account ID when authenticated.

---

## Verification Plan

### Automated Tests
1. **Frontend**: Verify the Settings and Onboarding UI compile without errors (`npm run build` in `renderer`).
2. **Backend**: Provide mock endpoints for `auth.openai.com` and the Anthropic auth endpoints and verify the Rowboat token refresh logic correctly issues new tokens.

### Manual Verification
1. Launch the modified Rowboat application using `npm run dev`.
2. Navigate to **Settings -> Models**.
3. Select "OpenAI", leave API key empty, and click the new "Sign in to ChatGPT" button.
4. Complete the browser-based OAuth flow.
5. Verify Rowboat displays "Connected as [Your Account]".
6. Prompt Rowboat Copilot or Agent to ensure the chat requests route successfully through `https://chatgpt.com/backend-api/codex/responses`.
7. Repeat the process for the new "Sign in to Claude Pro" button.
