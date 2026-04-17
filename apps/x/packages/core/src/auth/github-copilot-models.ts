/**
 * GitHub Copilot Model Integration
 * 
 * Handles GitHub Copilot model discovery and LLM provider initialization
 */

import { getGitHubCopilotApiToken, isGitHubCopilotAuthenticated } from './github-copilot-auth.js';
import { ProviderV2 } from '@ai-sdk/provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import z from 'zod';
import { LlmProvider } from '@x/shared/dist/models.js';

// GitHub Copilot API endpoint
const GITHUB_COPILOT_API_BASE = 'https://api.githubcopilot.com/';

// List of models available through GitHub Copilot
// Based on GitHub Copilot API documentation
// https://docs.github.com/en/copilot/using-github-copilot/asking-github-copilot-questions
export const GITHUB_COPILOT_MODELS = [
  'gpt-5.4-mini',
  'gpt-5-mini',
  'grok-code-fast-1',
  'claude-haiku-4.5',
  'gemini-3-flash-preview',
  'gpt-5.2',
  'gpt-4.1',
  'gpt-4o',
  'gemini-3.1-pro-preview',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gemini-2.5-pro'
] as const;

export type GitHubCopilotModel = typeof GITHUB_COPILOT_MODELS[number];

/**
 * Get available GitHub Copilot models
 * 
 * Returns a list of models that are available through GitHub Copilot
 */
export async function getAvailableGitHubCopilotModels(): Promise<string[]> {
  // For now, return all models
  // In the future, we could query the GitHub Models API to get the actual
  // list of available models for the authenticated user
  return [...GITHUB_COPILOT_MODELS];
}

/**
 * Create GitHub Copilot LLM provider
 * 
 * This automatically handles authentication and uses Device Flow if needed
 */
export async function createGitHubCopilotProvider(
  config: z.infer<typeof LlmProvider>
): Promise<ProviderV2> {
  if (config.flavor !== 'github-copilot') {
    throw new Error('Invalid provider config for GitHub Copilot');
  }

  // Check if authenticated
  const authenticated = await isGitHubCopilotAuthenticated();
  if (!authenticated) {
    throw new Error(
      'GitHub Copilot not authenticated. Please authenticate via Device Flow first.'
    );
  }

  // Get Copilot API token (handles refresh if needed)
  const accessToken = await getGitHubCopilotApiToken();

  // Create OpenAI-compatible provider with GitHub Copilot endpoint
  return createOpenAICompatible({
    name: "github-copilot",
    apiKey: accessToken,
    baseURL: config.baseURL || GITHUB_COPILOT_API_BASE,
    headers: {
      ...config.headers,
      'Editor-Version': 'vscode/1.88.0',
      'Editor-Plugin-Version': 'copilot-chat/0.14.0',
      'User-Agent': 'GitHubCopilotChat/0.14.0',
      'Accept': '*/*',
    },
  });
}

/**
 * Test GitHub Copilot connection
 * 
 * Verifies that authentication works and we can reach the API
 */
export async function testGitHubCopilotConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if authenticated
    const authenticated = await isGitHubCopilotAuthenticated();
    if (!authenticated) {
      return {
        success: false,
        error: 'GitHub Copilot not authenticated',
      };
    }

    // Try to get access token
    await getGitHubCopilotApiToken();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
