// The Harbor client every Rowboat app shares: REST (client.ts), the live
// socket (live.ts), the per-space subscriptions over it (subscriptions.ts),
// the IPC channels that are one Harbor call each (channels.ts), and the
// public-client OAuth a direct-to-Harbor app signs in with (oauth.ts). See
// apps/harbor/CONTRACT.md for the wire.

export { SpacesClient, SpacesRequestError } from './client.js';
export type { SpacesClientOptions, SpacesApiError, SpacesTokenProvider, ActivityQueryInput, MessageWindowOpts } from './client.js';
export { SpacesLive } from './live.js';
export type { SpacesLiveOptions, SpacesLiveStatus, SpaceFrameHandler } from './live.js';
export { SpaceSubscriptions } from './subscriptions.js';
export type { SpaceSubscriptionsDeps, LiveSubscriber } from './subscriptions.js';
export { harborChannelHandlers } from './channels.js';
export type { HarborChannel, HarborChannelHandlers, HarborChannelDeps } from './channels.js';
export {
  discoverIssuer,
  authServerMetadata,
  registerPublicClient,
  randomToken,
  pkceChallenge,
  authorizeUrl,
  exchangeCode,
  refreshTokens,
  SessionEndedError,
} from './oauth.js';
export type { SpacesTokens, AuthServerMetadata } from './oauth.js';
