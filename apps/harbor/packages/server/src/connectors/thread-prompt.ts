// What every connector Harbor runs writes into its agent's message (spec §8
// Connectors). Moved to the protocol package on 2026-10-28 (local agents), so
// the desktop app's connector says exactly the same; re-exported here so the
// connectors' imports stay put.
export {
  SKILL_URL,
  attachmentLinks,
  downloadLine,
  formatSize,
  leadingMentionOf,
  namingAttachments,
  requestMarker,
  standingParagraph,
  type Attachment,
} from '@rowboat/spaces-protocol';
