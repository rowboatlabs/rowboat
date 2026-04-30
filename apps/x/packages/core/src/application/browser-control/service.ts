import type { BrowserControlInput, BrowserControlResult } from '@x/shared/dist/browser-control.js';

export interface IBrowserControlService {
  execute(
    input: BrowserControlInput,
    ctx?: { signal?: AbortSignal },
  ): Promise<BrowserControlResult>;
}
