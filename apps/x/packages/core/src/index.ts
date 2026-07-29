// Workspace filesystem operations
export * as workspace from './workspace/workspace.js';

// Workspaces that live outside WorkDir (folders the user pointed Rowboat at)
export * as linkedFolders from './workspace/linked-folders.js';

// Workspace watcher
export * as watcher from './workspace/watcher.js';

// Config initialization
export { initConfigs } from './config/initConfigs.js';

// Knowledge version history
export * as versionHistory from './knowledge/version_history.js';

// Voice mode (config + TTS)
export * as voice from './voice/voice.js';
