import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createGate } from './gate.js';
import { seedWorkdir } from './seed.js';

// Instance entry point on Fly (roadmap phase 0, 30/09/2026): prepare the
// workdir, start the headless rowboat-server on loopback, open the gate.
// API_URL points core at the Baarali control plane, never at Rowboat Labs
// (architecture §3.14); no POSTHOG_KEY is set, so core analytics stay off.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const workDir = process.env.ROWBOAT_WORKDIR ?? '/data';
const serverPort = 3220;

await seedWorkdir({
  workDir,
  instanceToken: required('BAARALI_INSTANCE_TOKEN'),
  serverKey: process.env.BAARALI_SERVER_KEY || undefined,
  assistantModel: process.env.BAARALI_ASSISTANT_MODEL ?? 'deepseek/deepseek-v4.1-flash',
  mediaServer: {
    command: process.execPath,
    args: [fileURLToPath(new URL('./media-mcp-main.js', import.meta.url))],
    env: { ROWBOAT_WORKDIR: workDir, API_URL: required('API_URL') },
  },
});

const child = spawn(process.execPath, [required('ROWBOAT_SERVER_ENTRY')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ROWBOAT_WORKDIR: workDir,
    ROWBOAT_SERVER_PORT: String(serverPort),
    API_URL: required('API_URL'),
    // Spaces cannot verify the instance token: core trades it there (core
    // auth/spaces-exchange.ts, control POST /v1/spaces/token).
    BAARALI_SPACES_TOKEN_URL: `${required('API_URL').replace(/\/+$/, '')}/v1/spaces/token`,
    // The instance token is the session in oauth.json; the server needs no copy.
    BAARALI_INSTANCE_TOKEN: '',
    // Same for the server key: it reads it from its file.
    BAARALI_SERVER_KEY: '',
  },
});

// The server key, as seeded (seed.ts): what the gateway sends for the apps too.
const keyFile = path.join(workDir, 'server-key');
const serverKey = (): string | null => {
  try {
    return readFileSync(keyFile, 'utf8').trim() || null;
  } catch {
    return null;
  }
};
const gate = createGate({ targetPort: serverPort, apps: { port: 3210, serverKey } });
const port = Number(process.env.PORT ?? '8080');
gate.listen(port, '0.0.0.0', () => console.log(`[instance] gate on :${port} → 127.0.0.1:${serverPort}`));

// One process tree: if the server dies, the machine restarts it whole.
child.on('exit', (code, signal) => {
  console.error(`[instance] rowboat-server exited (${signal ?? code})`);
  gate.close();
  process.exit(code ?? 1);
});
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => child.kill(sig));
}
