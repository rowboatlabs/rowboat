// The message a coding-agent connector sends into a thread's workspace (spec
// §8 Connectors). Moved to the protocol package on 2026-10-28 (local agents),
// so the desktop app's connector builds the same one; re-exported here so the
// connectors' imports stay put.
export { attachmentLinks, buildPrompt, environmentTag, requestMarker, type Attachment } from '@rowboat/spaces-protocol';
