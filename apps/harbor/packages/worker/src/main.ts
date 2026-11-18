#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CodexRuntime } from './codex/runtime.js';
import { errorText, makeLogger, type Logger } from './log.js';
import { ThreadState, type ThreadRecord } from './state.js';
import { Worker } from './worker.js';

// The command: `rowboat-worker --url https://org.example --agent codex --cwd /data/workspace --state /data/rowboat/worker [--idle 600]`.
// The key comes from ROWBOAT_AGENT_KEY or --key-file, and is never written anywhere by the worker.

const USAGE = `usage: rowboat-worker --url <harbor-url> [--agent codex] [--cwd <dir>] [--state <dir>] [--idle <seconds>] [--key-file <path>]
       [--codex <bin>] [--sandbox danger-full-access|workspace-write|read-only] [--lock <file>]
  The agent's key: ROWBOAT_AGENT_KEY in the environment, or --key-file.
  --idle: exit after this many seconds with nothing to do (a box that should sleep); unset runs until stopped.
  --lock: one worker per machine; a second start finds the first alive and exits at once.
  <state>/seed.json, when present, is read once: sessions kept elsewhere for conversations this worker has not seen.`;

/**
 * One worker per machine (a Maritime box started by Harbor on every
 * invocation that finds no worker connected): the lock file names the
 * process that holds it; a dead holder's lock is taken over.
 */
function takeLock(file: string, log: Logger): boolean {
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) {
    const pid = Number(readFileSync(file, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid)) {
      log(`another worker (pid ${pid}) holds ${file}; exiting`);
      return false;
    }
  }
  writeFileSync(file, String(process.pid));
  const release = () => {
    try {
      if (readFileSync(file, 'utf8').trim() === String(process.pid)) unlinkSync(file);
    } catch {
      // Already gone.
    }
  };
  process.on('exit', release);
  return true;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Sessions kept elsewhere (Harbor's exec-driven turns) for conversations this worker's record does not know yet. */
function takeSeed(state: ThreadState, stateDir: string, log: Logger): void {
  const file = join(stateDir, 'seed.json');
  if (!existsSync(file)) return;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { threads?: Record<string, ThreadRecord> };
    const added = state.seed(parsed.threads ?? {});
    if (added > 0) log(`took ${added} thread session(s) from the seed`);
  } catch (err) {
    log('the seed file could not be read; ignored', { error: errorText(err) });
  }
  try {
    unlinkSync(file);
  } catch {
    // Left in place; read again next time, harmlessly.
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const name = arg.slice(2);
    if (name === 'help') {
      out.help = 'true';
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    out[name] = value;
    i += 1;
  }
  return out;
}

async function main(): Promise<void> {
  const log = makeLogger();
  let args: Record<string, string>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(errorText(err));
    console.error(USAGE);
    process.exit(2);
  }
  if (args.help || !args.url) {
    console.error(USAGE);
    process.exit(args.help ? 0 : 2);
  }
  const key = (args['key-file'] ? readFileSync(args['key-file'], 'utf8') : process.env.ROWBOAT_AGENT_KEY ?? '').trim();
  if (!key) {
    console.error('no agent key: set ROWBOAT_AGENT_KEY or pass --key-file');
    process.exit(2);
  }
  const agent = args.agent ?? 'codex';
  if (agent !== 'codex') {
    console.error(`this worker runs codex only for now, not ${agent}`);
    process.exit(2);
  }
  const cwd = args.cwd ?? process.cwd();
  const stateDir = args.state ?? join(homedir(), '.rowboat', 'worker');
  const idleMs = args.idle ? Number(args.idle) * 1000 : undefined;
  const sandbox = args.sandbox as 'danger-full-access' | 'workspace-write' | 'read-only' | undefined;
  if (args.lock && !takeLock(args.lock, log)) process.exit(0);
  const state = new ThreadState(join(stateDir, 'threads.json'));
  takeSeed(state, stateDir, log);
  const runtime = new CodexRuntime({
    orgUrl: args.url,
    agentKey: key,
    cwd,
    log,
    ...(args.codex ? { command: args.codex } : {}),
    ...(sandbox ? { sandbox } : {}),
  });
  const worker = new Worker({
    baseUrl: args.url,
    key,
    cwd,
    runtime,
    state,
    log,
    ...(idleMs ? { idleMs, onIdle: () => process.exit(0) } : {}),
  });
  const shutdown = (signal: string) => {
    log(`${signal}: stopping`);
    void worker.stop().finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  log(`rowboat-worker ${process.env.ROWBOAT_WORKER_VERSION ?? 'dev'} starting`, { url: args.url, agent, cwd, state: stateDir, idleMs });
  await worker.start();
}

main().catch((err) => {
  console.error(`rowboat-worker: ${errorText(err)}`);
  process.exit(1);
});
