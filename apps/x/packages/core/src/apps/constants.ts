import path from 'path';
import { WorkDir } from '../config/config.js';

// Rowboat Apps constants (spec §3). All apps constants live here; values the
// renderer needs are mirrored through IPC responses, never imported directly.

export const APPS_DIR = path.join(WorkDir, 'apps');

// 3210 reuses the local-sites port (D8). ROWBOAT_APPS_PORT is the
// per-instance override for sandboxed dev instances (`npm run dev:sandbox`) —
// appOrigin() below derives from this constant, so app URLs follow along.
const envAppsPort = Number(process.env.ROWBOAT_APPS_PORT);
export const APPS_PORT = Number.isInteger(envAppsPort) && envAppsPort > 0 ? envAppsPort : 3210;
export const APPS_HOST_SUFFIX = '.apps.localhost'; // full host: <slug>.apps.localhost:3210
export const CONTROL_HOST = 'apps.localhost'; // control endpoints only (§6.4)

export const REGISTRY_REPO = process.env.ROWBOAT_APPS_REGISTRY || 'rowboatlabs/apps-registry';
export const REGISTRY_BRANCH = 'main';

export const CATALOG_CACHE_PATH = path.join(WorkDir, 'config', 'apps-catalog.json');
export const CATALOG_TTL_MS = 300_000; // 5 min, matches raw CDN cache horizon

export const MAX_BUNDLE_COMPRESSED = 100 * 1024 * 1024; // 100 MB (§12.1)
export const MAX_BUNDLE_UNCOMPRESSED = 500 * 1024 * 1024; // 500 MB (§12.1)
export const MAX_BUNDLE_ENTRIES = 10_000; // §12.1

export const MAX_DATA_FILE_BYTES = 50 * 1024 * 1024; // 50 MB (§7.3 PUT limit)

export const MAX_PROXY_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB (§7.5)
export const PROXY_TIMEOUT_MS = 30_000; // §7.5

export const MAX_LLM_REQUEST_BYTES = 256 * 1024; // 256 KB (§7.6)
export const LLM_MAX_OUTPUT_TOKENS = 4096; // §7.6 (requests clamp to it)
export const LLM_MAX_CONCURRENT_PER_APP = 2; // §7.6
export const LLM_TIMEOUT_MS = 120_000; // hard cap — a hung provider call must never pin a slot

export const MAX_COPILOT_PROMPT_BYTES = 16 * 1024; // 16 KB (§7.7)
export const COPILOT_RUN_TIMEOUT_MS = 600_000; // 10 min (§7.7)
export const COPILOT_MAX_CONCURRENT_PER_APP = 1; // §7.7

export const MAX_TTS_TEXT_CHARS = 5000; // voice/tts per-request text cap
export const MAX_VOICE_UPLOAD_BYTES = 32 * 1024 * 1024; // voice/transcribe JSON body cap (base64)
export const VOICE_MAX_CONCURRENT_PER_APP = 4; // shared across both voice endpoints

export const FOLDER_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/; // §4.1

// Networking note (§3): *.apps.localhost resolves to loopback in Chromium
// only. Main-process callers MUST connect to 127.0.0.1:APPS_PORT and set the
// Host header explicitly — never rely on OS DNS for *.localhost names.
export function appOrigin(folderSlug: string): string {
    return `http://${folderSlug}${APPS_HOST_SUFFIX}:${APPS_PORT}`;
}
