import { open } from 'node:fs/promises';
import { previewSlackExport, SLACK_PREVIEW_LIMITS } from './slack.js';

// Local inspection only (2026-11-12). No service, credentials or database connection.
const path = process.argv[2];
if (!path || process.argv.length !== 3) {
  console.error('Usage: pnpm preview:slack /path/to/slack-export.zip');
  process.exitCode = 1;
} else {
  try {
    const file = await open(path, 'r');
    let bytes: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > SLACK_PREVIEW_LIMITS.zipBytes) throw new Error('Expected a regular ZIP file within the upload limit.');
      // Bound reads even if the file grows after stat().
      const chunks: Buffer[] = []; let length = 0;
      for await (const chunk of file.createReadStream({ autoClose: false })) {
        length += chunk.length;
        if (length > SLACK_PREVIEW_LIMITS.zipBytes) throw new Error('ZIP exceeds the upload limit.');
        chunks.push(Buffer.from(chunk));
      }
      bytes = Buffer.concat(chunks);
    } finally { await file.close(); }
    const preview = await previewSlackExport(bytes);
    console.log(JSON.stringify({
      channels: preview.channels.map(({ messages: _messages, memberIds, ...channel }) => ({ ...channel, historicalMembers: memberIds.length })),
      identities: preview.identities.length, records: preview.records, warnings: preview.warnings,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not preview Slack export.');
    process.exitCode = 1;
  }
}
