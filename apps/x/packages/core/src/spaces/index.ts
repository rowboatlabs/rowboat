// Spaces (client side): the app's connection to orgs speaking the spaces
// protocol. See apps/harbor/CONTRACT.md for the wire contract; the stub Harbor
// (@rowboat/harbor) is the dev/test server until the real one lands.

export { SpacesClient, SpacesRequestError } from './client.js';
export type { SpacesClientOptions, SpacesApiError } from './client.js';
export { SpacesLive } from './live.js';
export type { SpacesLiveOptions, SpacesLiveStatus, SpaceFrameHandler } from './live.js';
export { fetchLinkPreview } from './link-preview.js';
export type { LinkPreview } from './link-preview.js';
