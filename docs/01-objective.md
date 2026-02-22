# Objective

Integrate native ChatGPT Plus and Anthropic Claude Pro OAuth support into Rowboat so users can benefit from their existing subscriptions instead of using a pay-as-you-go API key.

## Context
Currently, Rowboat only accepts API keys, which incurs extra costs for users who already pay for AI subscriptions. Tools like OpenCode have reverse-engineered the browser and device OAuth flows to access these APIs (using `auth.openai.com` and `claude.ai/oauth/authorize`).

## Goals
1. Add new UI buttons in the Rowboat settings to "Sign in" to ChatGPT and Claude Pro.
2. Build local proxy endpoints/routes to handle PKCE redirects and token exchanges.
3. Automatically intercept Rowboat's OpenAI and Anthropic SDK calls, injecting the `Authorization: Bearer <token>` headers when OAuth is active.
4. Manage token expiration and refresh automatically in the background.

## Non-Goals
1. We are not officially partnering with OpenAI or Anthropic; these flows use undocumented methods to authenticate.
2. We are not replacing API keys entirely; users can still use them if they prefer.
