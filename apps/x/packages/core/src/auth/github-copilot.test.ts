/**
 * GitHub Copilot Tests
 * 
 * Comprehensive test suite for Device Flow OAuth and GitHub Copilot integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as deviceFlow from '../src/auth/github-copilot-device-flow';
import { OAuthTokens } from '../src/auth/types';

// Mock fetch
const originalFetch = global.fetch;
const mockFetch = vi.fn();

beforeEach(() => {
  global.fetch = mockFetch as any;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

describe('GitHub Copilot Device Flow', () => {
  describe('requestDeviceCode', () => {
    it('should request device code successfully', async () => {
      const mockResponse = {
        device_code: 'test_device_code',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await deviceFlow.requestDeviceCode('test_client_id');

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://github.com/login/device/code',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        })
      );
    });

    it('should handle request errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
      });

      await expect(
        deviceFlow.requestDeviceCode('test_client_id')
      ).rejects.toThrow('Failed to request device code');
    });

    it('should support custom scopes', async () => {
      const mockResponse = {
        device_code: 'test_device_code',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await deviceFlow.requestDeviceCode('test_client_id', ['read:user', 'gist']);

      const call = mockFetch.mock.calls[0];
      expect(call[1].body).toContain('scope=read:user+gist');
    });
  });

  describe('pollForToken', () => {
    it('should successfully poll and get token', async () => {
      const tokenResponse = {
        access_token: 'test_access_token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'read:user user:email gist',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => tokenResponse,
      });

      const tokens = await deviceFlow.pollForToken(
        'test_client_id',
        'test_device_code',
        Date.now() + 10000
      );

      expect(tokens.access_token).toBe('test_access_token');
      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.expires_at).toBeGreaterThan(0);
      expect(tokens.scopes).toContain('read:user');
    });

    it('should handle authorization_pending error', async () => {
      const pendingResponse = {
        error: 'authorization_pending',
      };

      const successResponse = {
        access_token: 'test_access_token',
        token_type: 'Bearer',
        expires_in: 3600,
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => pendingResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => successResponse,
        });

      const tokens = await deviceFlow.pollForToken(
        'test_client_id',
        'test_device_code',
        Date.now() + 10000
      );

      expect(tokens.access_token).toBe('test_access_token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle slow_down error', async () => {
      const slowDownResponse = {
        error: 'slow_down',
      };

      const successResponse = {
        access_token: 'test_access_token',
        token_type: 'Bearer',
        expires_in: 3600,
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => slowDownResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => successResponse,
        });

      const startTime = Date.now();
      const tokens = await deviceFlow.pollForToken(
        'test_client_id',
        'test_device_code',
        startTime + 20000
      );

      expect(tokens.access_token).toBe('test_access_token');
    });

    it('should handle expired_token error', async () => {
      const expiredResponse = {
        error: 'expired_token',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => expiredResponse,
      });

      await expect(
        deviceFlow.pollForToken(
          'test_client_id',
          'test_device_code',
          Date.now() + 1000
        )
      ).rejects.toThrow('Device code expired');
    });

    it('should handle access_denied error', async () => {
      const deniedResponse = {
        error: 'access_denied',
        error_description: 'User cancelled',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deniedResponse,
      });

      await expect(
        deviceFlow.pollForToken(
          'test_client_id',
          'test_device_code',
          Date.now() + 10000
        )
      ).rejects.toThrow('User cancelled');
    });

    it('should handle timeout', async () => {
      const pendingResponse = {
        error: 'authorization_pending',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => pendingResponse,
      });

      // Set expiration in the past
      const expiredTime = Date.now() - 1000;

      await expect(
        deviceFlow.pollForToken(
          'test_client_id',
          'test_device_code',
          expiredTime
        )
      ).rejects.toThrow('Device code expired');
    });
  });

  describe('startGitHubCopilotAuth', () => {
    it('should start authentication flow', async () => {
      const deviceCodeResponse = {
        device_code: 'test_device_code',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      };

      const tokenResponse = {
        access_token: 'test_access_token',
        token_type: 'Bearer',
        expires_in: 3600,
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => deviceCodeResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => tokenResponse,
        });

      const { deviceCode, tokenPromise } = await deviceFlow.startGitHubCopilotAuth('test_client_id');

      expect(deviceCode.user_code).toBe('ABCD-1234');
      expect(deviceCode.verification_uri).toBe('https://github.com/login/device');

      const tokens = await tokenPromise;
      expect(tokens.access_token).toBe('test_access_token');
    });

    it('should support custom scopes in auth flow', async () => {
      const deviceCodeResponse = {
        device_code: 'test_device_code',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => deviceCodeResponse,
      });

      const customScopes = ['read:user', 'gist', 'repo'];
      await deviceFlow.startGitHubCopilotAuth('test_client_id', customScopes);

      const call = mockFetch.mock.calls[0];
      expect(call[1].body).toContain('read:user');
      expect(call[1].body).toContain('gist');
      expect(call[1].body).toContain('repo');
    });
  });

  describe('OAuthTokens validation', () => {
    it('should properly parse tokens', () => {
      const tokenData = {
        access_token: 'test_token',
        refresh_token: null,
        expires_at: 1234567890,
        token_type: 'Bearer' as const,
        scopes: ['read:user', 'user:email'],
      };

      const tokens = OAuthTokens.parse(tokenData);

      expect(tokens.access_token).toBe('test_token');
      expect(tokens.refresh_token).toBeNull();
      expect(tokens.expires_at).toBe(1234567890);
      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.scopes).toEqual(['read:user', 'user:email']);
    });

    it('should validate token structure', () => {
      const invalidTokenData = {
        access_token: '', // Empty token
        refresh_token: null,
        expires_at: 0, // Invalid expiration
      };

      expect(() => {
        OAuthTokens.parse(invalidTokenData);
      }).toThrow();
    });
  });
});

describe('GitHub Copilot Models', () => {
  describe('Model availability', () => {
    it('should list available models', async () => {
      const { getAvailableGitHubCopilotModels } = await import('../src/auth/github-copilot-models');
      const models = await getAvailableGitHubCopilotModels();

      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-4-turbo');
      expect(models).toContain('gpt-4');
      expect(models).toContain('gpt-3.5-turbo');
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });
  });

  describe('Model constants', () => {
    it('should have valid model names', async () => {
      const { GITHUB_COPILOT_MODELS } = await import('../src/auth/github-copilot-models');

      expect(GITHUB_COPILOT_MODELS).toContain('gpt-4o');
      expect(GITHUB_COPILOT_MODELS).toContain('gpt-4-turbo');
      expect(GITHUB_COPILOT_MODELS.length).toBeGreaterThan(0);
    });
  });
});
