export type RuntimeShellDialect = 'windows-cmd' | 'posix-sh';
export type RuntimeOsName = 'Windows' | 'macOS' | 'Linux' | 'Unknown';

export interface RuntimeContext {
  platform: NodeJS.Platform;
  osName: RuntimeOsName;
  shellDialect: RuntimeShellDialect;
  shellExecutable: string;
}

export function getExecutionShell(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
}

export function getRuntimeContext(platform: NodeJS.Platform = process.platform): RuntimeContext {
  if (platform === 'win32') {
    return {
      platform,
      osName: 'Windows',
      shellDialect: 'windows-cmd',
      shellExecutable: getExecutionShell(platform),
    };
  }

  if (platform === 'darwin') {
    return {
      platform,
      osName: 'macOS',
      shellDialect: 'posix-sh',
      shellExecutable: getExecutionShell(platform),
    };
  }

  if (platform === 'linux') {
    return {
      platform,
      osName: 'Linux',
      shellDialect: 'posix-sh',
      shellExecutable: getExecutionShell(platform),
    };
  }

  return {
    platform,
    osName: 'Unknown',
    shellDialect: 'posix-sh',
    shellExecutable: getExecutionShell(platform),
  };
}

export function getRuntimeContextPrompt(runtime: RuntimeContext): string {
  if (runtime.shellDialect === 'windows-cmd') {
    return `## Runtime Platform (CRITICAL)
- Detected platform: **${runtime.platform}**
- Detected OS: **${runtime.osName}**
- Shell used by executeCommand: **${runtime.shellExecutable}** (Windows Command Prompt / cmd syntax)
- Use Windows command syntax for executeCommand (for example: \`dir\`, \`type\`, \`copy\`, \`move\`, \`del\`, \`rmdir\`).
- Use Windows-style absolute paths when outside workspace (for example: \`C:\\Users\\...\`).
- Do not assume macOS/Linux command syntax when the runtime is Windows.`;
  }

  return `## Runtime Platform (CRITICAL)
- Detected platform: **${runtime.platform}**
- Detected OS: **${runtime.osName}**
- Shell used by executeCommand: **${runtime.shellExecutable}** (POSIX sh syntax)
- Use POSIX command syntax for executeCommand (for example: \`ls\`, \`cat\`, \`cp\`, \`mv\`, \`rm\`).
- Use POSIX paths when outside workspace (for example: \`~/Desktop\`, \`/Users/.../\` on macOS, \`/home/.../\` on Linux).
- Do not assume Windows command syntax when the runtime is POSIX.`;
}
