// Workspace filesystem operations
export * as workspace from './workspace/workspace.js';

// Workspace watcher
export * as watcher from './workspace/watcher.js';

// Config initialization
export { initConfigs } from './config/initConfigs.js';

// Knowledge version history
export * as versionHistory from './knowledge/version_history.js';

// Voice mode (config + TTS)
export * as voice from './voice/voice.js';

// System CA integration (enterprise proxies / OS trust stores)
export * as systemCa from './security/system-ca.js';
export { initSystemCertificates, getSystemCertificates, writeSystemCaBundle } from './security/system-ca.js';
