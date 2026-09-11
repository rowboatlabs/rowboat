import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { loginShellPath } from './shell-env.js';

export const OPENCODE_ROOT = path.join(os.homedir(), '.rowboat', 'opencode');

// Allowlist instead of an inevitably incomplete list of provider secret names.
// Project tools keep PATH and basic OS/home/temp/locale settings, but credentials
// and executable/config injection (NODE_OPTIONS, BUN_OPTIONS, etc.) are not imported.
const SYSTEM_ENV = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|SYSTEMDRIVE|TEMP|TMP|TMPDIR|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|USERNAME|USER|LOGNAME|SHELL|LANG|LC_[A-Z_]+|TZ|TERM|COLORTERM)$/i;

export function buildOpenCodeEnvironment(
    inherited: NodeJS.ProcessEnv = process.env,
    root = OPENCODE_ROOT,
    toolPath = loginShellPath(),
): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(inherited)) {
        if (SYSTEM_ENV.test(key) && key.toUpperCase() !== 'PATH') env[key] = value;
    }
    const inheritedPath = Object.entries(inherited).find(([key]) => key.toUpperCase() === 'PATH')?.[1];
    env.PATH = [...new Set([toolPath, inheritedPath].filter(Boolean).flatMap(p => p!.split(path.delimiter)))].join(path.delimiter);
    for (const [key, directory] of Object.entries({ XDG_CONFIG_HOME: 'config', XDG_DATA_HOME: 'data', XDG_CACHE_HOME: 'cache', XDG_STATE_HOME: 'state' })) {
        env[key] = path.join(root, directory);
    }
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ enabled_providers: ['opencode', 'opencode-go'] });
    env.OPENCODE_DISABLE_AUTOUPDATE = 'true';
    env.OPENCODE_DISABLE_TERMINAL_TITLE = 'true';
    return env;
}

export function prepareOpenCodeState(root = OPENCODE_ROOT): void {
    for (const directory of ['config', 'data', 'cache', 'state']) {
        fs.mkdirSync(path.join(root, directory), { recursive: true, mode: 0o700 });
    }
}
