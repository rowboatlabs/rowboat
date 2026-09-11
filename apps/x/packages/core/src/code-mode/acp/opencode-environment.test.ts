import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
vi.mock('./shell-env.js', () => ({ loginShellPath: () => undefined }));
import { buildOpenCodeEnvironment } from './opencode-environment.js';

describe('OpenCode state isolation', () => {
    it('preserves project tool PATH while excluding inherited credentials and injection overrides', () => {
        const inherited = { Path: 'C:\\tools with spaces', HOME: '/home/user', OPENCODE_CONFIG: '/global/config', OPENCODE_DB: '/global/db', OPENAI_API_KEY: 'secret', AWS_PROFILE: 'global', GOOGLE_APPLICATION_CREDENTIALS: '/global/key', NODE_OPTIONS: '--require evil', CUSTOM_PROVIDER_TOKEN: 'secret', XDG_DATA_HOME: '/global/data' };
        const env = buildOpenCodeEnvironment(inherited, '/rowboat state', undefined);
        expect(env.PATH).toBe(inherited.Path);
        expect(env.HOME).toBe(inherited.HOME);
        for (const key of ['OPENCODE_CONFIG', 'OPENCODE_DB', 'OPENAI_API_KEY', 'AWS_PROFILE', 'GOOGLE_APPLICATION_CREDENTIALS', 'NODE_OPTIONS', 'CUSTOM_PROVIDER_TOKEN']) expect(env[key]).toBeUndefined();
        expect(env.XDG_DATA_HOME).toBe(path.join('/rowboat state', 'data'));
        expect(env.XDG_CONFIG_HOME).toBe(path.join('/rowboat state', 'config'));
        expect(env.XDG_CACHE_HOME).toBe(path.join('/rowboat state', 'cache'));
        expect(env.XDG_STATE_HOME).toBe(path.join('/rowboat state', 'state'));
        expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT!)).toEqual({ enabled_providers: ['opencode', 'opencode-go'] });
        expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe('true');
        expect(inherited.XDG_DATA_HOME).toBe('/global/data');
    });
});
