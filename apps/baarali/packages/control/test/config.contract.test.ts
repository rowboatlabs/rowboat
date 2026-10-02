import { describe, expect, it } from 'vitest';
import { RowboatApiConfig } from '@x/shared/dist/rowboat-account.js';
import { buildApiConfig } from '../src/config.js';

// Contract test (roadmap phase 0): the body is validated by the upstream zod
// schema itself, so an upstream change to /v1/config breaks here at sync time.
describe('GET /v1/config body', () => {
  it('parses with the upstream RowboatApiConfig schema', () => {
    const body = buildApiConfig({ publicUrl: 'https://control.example.test/' });
    expect(() => RowboatApiConfig.parse(body)).not.toThrow();
  });

  it('points every URL at the control plane, never at Rowboat Labs', () => {
    const body = buildApiConfig({ publicUrl: 'https://control.example.test/' });
    expect(body.appUrl).toBe('https://control.example.test');
    expect(body.supabaseUrl).toBe('https://control.example.test');
    expect(JSON.stringify(body)).not.toContain('rowboatlabs.com');
  });

  it('says Composio is not served, so the apps never call /v1/composio', () => {
    expect(buildApiConfig({ publicUrl: 'https://control.example.test' }).composio).toBe(false);
  });

  it('names our own Spaces server once there is one, and none before', () => {
    expect(buildApiConfig({ publicUrl: 'https://control.example.test' }).spacesApexUrl).toBeNull();
    const body = buildApiConfig({ publicUrl: 'https://control.example.test', spacesUrl: 'https://spaces.example.test/' });
    expect(() => RowboatApiConfig.parse(body)).not.toThrow();
    expect(body.spacesApexUrl).toBe('https://spaces.example.test');
  });
});
