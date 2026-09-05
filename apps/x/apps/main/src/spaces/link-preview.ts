// The unfurl fetcher moved to core (packages/core/src/spaces/link-preview.ts)
// so the rowboat-server RPC handler serves the same cards in server mode.
// This re-export keeps main's in-process fallback handler wired.

export { fetchLinkPreview, type LinkPreview } from '@x/core/dist/spaces/link-preview.js';
