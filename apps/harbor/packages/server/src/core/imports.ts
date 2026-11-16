import type { SlackImportPreview } from '@rowboat/spaces-protocol';
import { previewSlackExport, SlackExportError } from '../imports/slack.js';
import { HarborError } from '../errors.js';
import type { ActorCtx, Kernel } from './kernel.js';

export class Imports {
  private active = 0;
  constructor(private readonly k: Kernel) {}

  async previewSlack(ctx: ActorCtx, bytes: Uint8Array): Promise<SlackImportPreview> {
    await this.k.requireActiveMember(ctx);
    // 2026-11-16: bound concurrent expansion without retaining users' archives.
    if (this.active >= 2) throw new HarborError('rate_limited', 'Two previews are already running. Try again shortly.');
    this.active++;
    try {
      const result = await previewSlackExport(Buffer.from(bytes));
      return {
        channels: result.channels.map(c => ({ id: c.id, name: c.name, private: c.private, archived: c.archived, ...c.preview })),
        warnings: result.warnings, records: result.records,
      };
    } catch (error) {
      if (error instanceof SlackExportError) throw new HarborError(error.code === 'limit_exceeded' ? 'payload_too_large' : 'invalid_request', error.message);
      throw error;
    } finally { this.active--; }
  }
}
