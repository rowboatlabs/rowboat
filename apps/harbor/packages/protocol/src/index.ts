// @rowboat/spaces-protocol — the v0 contract between Harbor (the spaces server)
// and everything that talks to it. See CONTRACT.md (workspace root) for the six
// wire decisions and the change process. v0 posture: breaking changes are
// expected and fine, but they happen HERE, via PR — never in a Slack message.

export * from './ids.js';
export * from './blob.js';
export * from './core.js';
export * from './changeset.js';
export * from './events.js';
export * from './invite.js';
export * from './search.js';
export * from './api.js';
export * from './mcp.js';
export * from './errors.js';
export * from './fixtures.js';
