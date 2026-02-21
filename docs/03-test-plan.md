# Test Plan

## Automated Tests
1. **Frontend**: Verify the Settings UI compiles without errors (`npm run build`).
2. **Backend**: Provide a mock endpoint for `auth.openai.com` to verify the Rowboat token refresh logic correctly intercepts and issues new tokens in `agents.ts`.

## Manual Verification
1. Launch the modified Rowboat application using `npm run dev`.
2. Navigate to **Settings -> Models**.
3. Select "OpenAI", leave API key empty, and click the new "Sign in to ChatGPT" button.
4. Complete the browser-based OAuth flow.
5. Verify Rowboat displays "Connected as [Your Account]".
6. Prompt Rowboat Copilot or Agent to ensure the chat requests route successfully through `https://chatgpt.com/backend-api/codex/responses`.
7. Repeat the process for the new "Sign in to Claude Pro" button.
