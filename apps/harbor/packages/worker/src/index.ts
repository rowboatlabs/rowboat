// @rowboat/worker — the worker that runs beside an agent's harness and carries
// Harbor's invocations to it (SPEC.md §8 Connectors, the agent worker,
// 2026-11-05). The command is main.ts; this is the library the desktop app
// and Harbor's tests embed.

export { Worker, type WorkerOptions } from './worker.js';
export { HarborClient, HarborLive, HarborRequestError, type HarborLiveOptions } from './harbor.js';
export { ThreadState, type ThreadRecord } from './state.js';
export { CodexRuntime, activityOf, type CodexRuntimeOptions } from './codex/runtime.js';
export { AppServer, AppServerError, type AppServerHandlers, type AppServerOptions } from './codex/app-server.js';
export { TurnOverError, type ModelChoice, type OpenSessionInput, type Runtime, type TurnEvent, type TurnHandle, type TurnInput, type TurnResult } from './runtime.js';
export { requestPrompt, steerText, continuation } from './prompt.js';
export { makeLogger, silentLogger, type Logger } from './log.js';
