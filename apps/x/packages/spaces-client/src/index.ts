// The Harbor client every Rowboat app shares: REST (client.ts) and the live
// socket (live.ts). See apps/harbor/CONTRACT.md for the wire.

export { SpacesClient, SpacesRequestError } from './client.js';
export type { SpacesClientOptions, SpacesApiError, SpacesTokenProvider, ActivityQueryInput, MessageWindowOpts } from './client.js';
export { SpacesLive } from './live.js';
export type { SpacesLiveOptions, SpacesLiveStatus, SpaceFrameHandler } from './live.js';
