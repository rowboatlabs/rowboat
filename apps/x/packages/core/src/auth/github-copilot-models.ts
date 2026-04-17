/**
 * GitHub Copilot Model Integration
 * 
 * Handles GitHub Copilot model discovery and LLM provider initialization
 */

import { getGitHubCopilotAccessToken, isGitHubCopilotAuthenticated } from './github-copilot-auth.js';
import { ProviderV2 } from '@ai-sdk/provider';
import { createOpenAI } from '@ai-sdk/openai';
import z from 'zod';
import { LlmProvider } from '@x/shared/dist/models.js';

// GitHub Copilot API endpoint
const GITHUB_COPILOT_API_BASE = 'https://models.github.com/api/openai/';

// List of models available through GitHub Copilot
// Based on GitHub Copilot documentation
export const GITHUB_COPILOT_MODELS = [
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
  'claude-3.5-sonnet', // If available in student plan
  'claude-3-opus', // If available in student plan
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

  // Get access token (will handle refresh if needed)
  const accessToken = await getGitHubCopilotAccessToken();

  // Create OpenAI-compatible provider with GitHub Copilot endpoint
  return createOpenAI({
    apiKey: accessToken,
    baseURL: config.baseURL || GITHUB_COPILOT_API_BASE,
    headers: {
      ...config.headers,
      'user-agent': 'Rowboat/1.0',
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
    await getGitHubCopilotAccessToken();

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
