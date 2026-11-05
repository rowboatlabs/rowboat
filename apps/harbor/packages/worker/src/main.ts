#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CodexRuntime } from './codex/runtime.js';
import { errorText, makeLogger } from './log.js';
import { ThreadState } from './state.js';
import { Worker } from './worker.js';

// The command: `rowboat-worker --url https://org.example --agent codex --cwd /data/workspace --state /data/rowboat/worker [--idle 600]`.
// The key comes from ROWBOAT_AGENT_KEY or --key-file, and is never written anywhere by the worker.

const USAGE = `usage: rowboat-worker --url <harbor-url> [--agent codex] [--cwd <dir>] [--state <dir>] [--idle <seconds>] [--key-file <path>]
       [--codex <bin>] [--sandbox danger-full-access|workspace-write|read-only]
  The agent's key: ROWBOAT_AGENT_KEY in the environment, or --key-file.
  --idle: exit after this many seconds with nothing to do (a box that should sleep); unset runs until stopped.`;

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
    state: new ThreadState(join(stateDir, 'threads.json')),
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
