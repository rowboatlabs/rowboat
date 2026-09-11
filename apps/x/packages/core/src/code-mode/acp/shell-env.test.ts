import { expect, it, vi } from 'vitest';

it('recovers Unix tool PATH through a shell path containing spaces without shell interpolation', async () => {
    const previous = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.stubEnv('SHELL', '/custom shells/zsh');
    const execFileSync = vi.fn(() => 'profile message\n/opt/homebrew/bin:/usr/bin:/bin\n');
    vi.doMock('child_process', () => ({ execFileSync }));
    vi.resetModules();
    try {
        const { loginShellPath } = await import('./shell-env.js');
        expect(loginShellPath()).toBe('/opt/homebrew/bin:/usr/bin:/bin');
        expect(execFileSync).toHaveBeenCalledWith('/custom shells/zsh', ['-lc', 'printf "%s\\n" "$PATH"'], expect.objectContaining({ timeout: 5000, maxBuffer: 65536 }));
        loginShellPath();
        expect(execFileSync).toHaveBeenCalledOnce();
    } finally {
        Object.defineProperty(process, 'platform', previous);
        vi.unstubAllEnvs();
    }
});
