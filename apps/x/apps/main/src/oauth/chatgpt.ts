import crypto from 'crypto';

export const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const ISSUER = 'https://auth.openai.com';

export interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export interface DeviceAuthResponse {
  device_auth_id: string;
  user_code: string;
  interval: string;
  verification_uri?: string;
}

export class ChatGPTAuth {
  /**
   * Initiates the Device Authorization flow and returns the code the user needs to enter.
   */
  static async initiateDeviceAuth(): Promise<{ deviceData: DeviceAuthResponse; instructions: string; url: string }> {
    const deviceResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `rowboat/1.0.0`,
      },
      body: JSON.stringify({ client_id: CLIENT_ID }),
    });

    if (!deviceResponse.ok) {
        throw new Error('Failed to initiate device authorization');
    }

    const deviceData = (await deviceResponse.json()) as DeviceAuthResponse;

    return {
      deviceData,
      url: `${ISSUER}/codex/device`,
      instructions: `Please visit the URL and enter the code: ${deviceData.user_code}`,
    };
  }

  /**
   * Polls the auth server waiting for the user to complete the device authorization flow.
   */
  static async pollForTokens(deviceData: DeviceAuthResponse): Promise<TokenResponse> {
    const interval = Math.max(parseInt(deviceData.interval) || 5, 1) * 1000;
    
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `rowboat/1.0.0`,
        },
        body: JSON.stringify({
          device_auth_id: deviceData.device_auth_id,
          user_code: deviceData.user_code,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          authorization_code: string;
          code_verifier: string;
        };

        const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: data.authorization_code,
            redirect_uri: `${ISSUER}/deviceauth/callback`,
            client_id: CLIENT_ID,
            code_verifier: data.code_verifier,
          }).toString(),
        });

        if (!tokenResponse.ok) {
          throw new Error(`Token exchange failed: ${tokenResponse.status}`);
        }

        const tokens: TokenResponse = await tokenResponse.json();
        return tokens;
      }

      // 403 / 404 generally means authorization is still pending
      if (response.status !== 403 && response.status !== 404) {
        throw new Error('Device authorization failed or timed out.');
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  /**
   * Refreshes an expired access token using the refresh token.
   */
  static async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    const response = await fetch(`${ISSUER}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    return response.json();
  }
}
