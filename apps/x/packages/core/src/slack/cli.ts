import type { ExecFileOptions } from 'node:child_process';

export function agentSlackExecutable(): string {
    return process.platform === 'win32' ? 'agent-slack.cmd' : 'agent-slack';
}

export function npmExecutable(): string {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function commandShimExecOptions(): Pick<ExecFileOptions, 'shell' | 'windowsHide'> {
    return process.platform === 'win32'
        ? { shell: true, windowsHide: true }
        : {};
}
