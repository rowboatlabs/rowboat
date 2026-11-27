import { describe, expect, it } from 'vitest';
import { BrowserControlInputSchema, BrowserPageSnapshotSchema } from './browser-control.js';
import { ipcSchemas } from './ipc.js';

describe('browser wire compatibility', () => {
  it('accepts old navigation requests and new explicit tab requests', () => {
    for (const action of ['back', 'forward', 'reload'] as const) {
      const schema = ipcSchemas[`browser:${action}`].req;
      expect(schema.parse(null)).toBeNull();
      expect(schema.parse({ tabId: 'A' })).toEqual({ tabId: 'A' });
      expect(schema.safeParse({ tabId: '' }).success).toBe(false);
    }
    expect(ipcSchemas['browser:navigate'].req.parse({ url: 'https://example.com' })).toEqual({ url: 'https://example.com' });
    expect(BrowserControlInputSchema.parse({ action: 'read-page', tabId: 'A' }).tabId).toBe('A');
  });

  it('continues to read saved snapshots without a tab id', () => {
    const old = { snapshotId: 'old', url: 'https://example.com', title: '', text: '', loading: false, elements: [] };
    expect(BrowserPageSnapshotSchema.parse(old)).toEqual(old);
    expect(BrowserPageSnapshotSchema.parse({ ...old, tabId: 'A' }).tabId).toBe('A');
  });

  it('rejects unknown settings and accepts reload failure responses', () => {
    expect(ipcSchemas['browser:updateSettings'].req.safeParse({ partition: 'different' }).success).toBe(false);
    expect(ipcSchemas['browser:updateSettings'].req.safeParse({ tabRailOpen: 'true' }).success).toBe(false);
    expect(ipcSchemas['browser:reload'].res.parse({ ok: false, error: 'Tab closed' })).toEqual({ ok: false, error: 'Tab closed' });
  });
});
