import { exec, execSync, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { getSecurityAllowList } from '../../config/security.js';
import { getExecutionShell } from '../assistant/runtime-context.js';

const execPromise = promisify(exec);

const COMMAND_SPLIT_REGEX = /(?:\|\||&&|;|\||\n|`|\$\(|\(|\))/;
const ENV_ASSIGNMENT_REGEX = /^[A-Za-z_][A-Za-z0-9_]*=.*/;
const WRAPPER_COMMANDS = new Set(['sudo', 'env', 'time', 'command']);
const EXECUTION_SHELL = getExecutionShell();

function sanitizeToken(token: string): string {
  return token.trim().replace(/^['"()]+|['"()]+$/g, '');
}

/**
 * Extract command-name segments from a shell command string.
 * Each segment is the leading tokens (after env-var assignments) of a
 * pipeline / chain element, joined by spaces and lowercased.
 * e.g. "cd ~/foo && npx acpx@latest claude exec 'hello'" → ["cd", "npx acpx@latest claude exec"]
 */
function extractCommandSegments(command: string): string[] {
  const segments: string[] = [];
  const stripped = command.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const parts = stripped.split(COMMAND_SPLIT_REGEX);

  for (const part of parts) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;

    let index = 0;
    while (index < tokens.length && ENV_ASSIGNMENT_REGEX.test(tokens[index])) {
      index++;
    }
    if (index >= tokens.length) continue;

    const cmdTokens = tokens.slice(index).map(t => sanitizeToken(t).toLowerCase()).filter(Boolean);
    if (cmdTokens.length) {
      segments.push(cmdTokens.join(' '));
    }
  }

  return segments;
}

export function extractCommandNames(command: string): string[] {
  const discovered = new Set<string>();
  for (const segment of extractCommandSegments(command)) {
    const first = segment.split(/\s+/)[0];
    if (first) discovered.add(first);
  }
  return Array.from(discovered);
}

/**
 * Prefix-based allow check: a command segment is allowed if any allowlist
 * entry is a prefix of it. e.g. allowlist "npx" allows "npx acpx@latest ...",
 * and allowlist "npx acpx@latest" also allows "npx acpx@latest claude exec ...".
 */
function isSegmentAllowed(segment: string, allowEntries: string[]): boolean {
  for (const entry of allowEntries) {
    // entry is a prefix of the segment (e.g. "npx" matches "npx acpx@latest claude exec")
    if (segment === entry || segment.startsWith(entry + ' ')) {
      return true;
    }
  }
  return false;
}

function findBlockedCommands(command: string, sessionAllowedCommands?: Set<string>): string[] {
  const segments = extractCommandSegments(command);
  if (!segments.length) return [];

  const allowList = getSecurityAllowList();
  if (!allowList.length && (!sessionAllowedCommands || sessionAllowedCommands.size === 0)) {
    return segments.map(s => s.split(/\s+/)[0]);
  }

  const allowSet = new Set(allowList);
  if (allowSet.has('*')) return [];

  const allEntries = [...allowSet, ...(sessionAllowedCommands ?? [])];

  const blocked: string[] = [];
  for (const segment of segments) {
    if (!isSegmentAllowed(segment, allEntries)) {
      const first = segment.split(/\s+/)[0];
      if (first) blocked.push(first);
    }
  }
  return blocked;
}

export function isBlocked(command: string, sessionAllowedCommands?: Set<string>): boolean {
  const blocked = findBlockedCommands(command, sessionAllowedCommands);
  return blocked.length > 0;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Executes an arbitrary shell command
 * @param command - The command to execute (e.g., "cat abc.txt | grep 'abc@gmail.com'")
 * @param options - Optional execution options
 * @returns Promise with stdout, stderr, and exit code
 */
export async function executeCommand(
  command: string,
  options?: {
    cwd?: string;
    timeout?: number; // timeout in milliseconds
    maxBuffer?: number; // max buffer size in bytes
  }
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execPromise(command, {
      cwd: options?.cwd,
      timeout: options?.timeout,
      maxBuffer: options?.maxBuffer || 1024 * 1024, // default 1MB
      shell: EXECUTION_SHELL,
    });

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
    };
  } catch (error: unknown) {
    // exec throws an error if the command fails or times out
    const e = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: e.stdout?.trim() || '',
      stderr: e.stderr?.trim() || e.message || '',
      exitCode: e.code || 1,
    };
  }
}

export interface AbortableCommandResult extends CommandResult {
  wasAborted: boolean;
}

const SIGKILL_GRACE_MS = 200;

/**
 * Kill a process tree using negative PID (process group kill on Unix).
 * Falls back to direct kill if group kill fails.
 */
function killProcessTree(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (!proc.pid || proc.killed) return;
  try {
    // Negative PID kills the entire process group (Unix)
    process.kill(-proc.pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {
      // Process may already be dead
    }
  }
}

/**
 * Executes a shell command with abort support.
 * Uses spawn with detached=true to create a process group for proper tree killing.
 * Returns both the promise and the child process handle.
 */
export function executeCommandAbortable(
  command: string,
  options?: {
    cwd?: string;
    timeout?: number;
    maxBuffer?: number;
    signal?: AbortSignal;
    onData?: (chunk: string) => void;
  }
): { promise: Promise<AbortableCommandResult>; process: ChildProcess } {
  // Check if already aborted before spawning
  if (options?.signal?.aborted) {
    // Return a dummy process and a resolved result
    const dummyProc = spawn(process.execPath, ['-e', 'process.exit(0)']);
    dummyProc.kill();
    return {
      process: dummyProc,
      promise: Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 130,
        wasAborted: true,
      }),
    };
  }

  const proc = spawn(command, [], {
    shell: EXECUTION_SHELL,
    cwd: options?.cwd,
    detached: process.platform !== 'win32', // Create process group on Unix
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const promise = new Promise<AbortableCommandResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let wasAborted = false;
    let exited = false;

    // Collect output
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const maxBuffer = options?.maxBuffer || 1024 * 1024;
      if (stdout.length < maxBuffer) {
        stdout += text;
      }
      options?.onData?.(text);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const maxBuffer = options?.maxBuffer || 1024 * 1024;
      if (stderr.length < maxBuffer) {
        stderr += text;
      }
      options?.onData?.(text);
    });

    // Abort handler
    const abortHandler = () => {
      wasAborted = true;
      killProcessTree(proc, 'SIGTERM');
      // Force kill after grace period
      setTimeout(() => {
        if (!exited) {
          killProcessTree(proc, 'SIGKILL');
        }
      }, SIGKILL_GRACE_MS);
    };

    if (options?.signal) {
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    // Timeout handler
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeout) {
      timeoutId = setTimeout(() => {
        wasAborted = true;
        killProcessTree(proc, 'SIGTERM');
        setTimeout(() => {
          if (!exited) {
            killProcessTree(proc, 'SIGKILL');
          }
        }, SIGKILL_GRACE_MS);
      }, options.timeout);
    }

    proc.once('exit', (code) => {
      exited = true;
      // Cleanup listeners
      if (options?.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (wasAborted) {
        stdout += '\n\n(Command was aborted)';
      }

      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code ?? 1,
        wasAborted,
      });
    });

    proc.once('error', (err) => {
      exited = true;
      if (options?.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
        wasAborted,
      });
    });
  });

  return { promise, process: proc };
}

/**
 * Executes a command synchronously (blocking)
 * Use with caution - prefer executeCommand for async execution
 */
export function executeCommandSync(
  command: string,
  options?: {
    cwd?: string;
    timeout?: number;
  }
): CommandResult {
  try {
    const stdout = execSync(command, {
      cwd: options?.cwd,
      timeout: options?.timeout,
      encoding: 'utf-8',
      shell: EXECUTION_SHELL,
    });

    return {
      stdout: stdout.trim(),
      stderr: '',
      exitCode: 0,
    };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; status?: number; message?: string };
    return {
      stdout: e.stdout?.toString().trim() || '',
      stderr: e.stderr?.toString().trim() || e.message || '',
      exitCode: e.status || 1,
    };
  }
}
