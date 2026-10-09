// Spaces (client side): the app's connection to orgs speaking the spaces
// protocol. See apps/harbor/CONTRACT.md for the wire contract. The Harbor
// client itself (REST + live socket) is @x/spaces-client, shared with the
// phone.

export { fetchLinkPreview } from './link-preview.js';
export type { LinkPreview } from './link-preview.js';
