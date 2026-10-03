import fs from 'node:fs/promises';
import path from 'node:path';

// Prepares an instance workdir before rowboat-server boots (roadmap phase 0,
// 30/09/2026). Only files the upstream already reads are written, in their
// upstream shape, so no upstream file changes (UPSTREAM.md §2). What the
// person changes later in the app is kept: only the control-plane session is
// rewritten on every boot, because the control plane owns it.

export interface SeedOptions {
  workDir: string;
  /** Bearer the control plane issued to this instance (core reads it as the Rowboat session). */
  instanceToken: string;
  /**
   * rowboat-server's bearer key, when the control plane sets it (its
   * gateway relays with it, security §2). Unset: the server keeps the key it
   * minted, as on the owner's instance of phase 0.
   */
  serverKey?: string;
  /** Model used until the person picks one, as an OpenRouter id. */
  assistantModel: string;
  /** How rowboat-server starts the media MCP server (media-mcp-main.ts). */
  mediaServer?: { command: string; args: string[]; env: Record<string, string> };
}

/** Our entries in the person's MCP config and skills; rewritten on every boot, the rest is theirs. */
export const MEDIA_SERVER_NAME = 'baarali-media';
export const MEDIA_SKILL_DIR = 'baarali-media';
/** Their names until the rename to Baarali (01/10/2026): removed from existing workdirs. */
const FORMER_MEDIA_NAME = 'warell-media';

// The skill tells the agent our media server exists and how its two steps
// work. Disk skills may only name existing builtins (disk-loader.ts): the MCP
// bridge ones, which keep their mcp-execute approval.
export const MEDIA_SKILL = `---
name: Video, voice and music
description: Generate a video, a voice-over (text to speech) or a song/music track. Load whenever the user asks to create, make or generate a video, clip, animation, voice, narration, audio reading, song, jingle or music.
tools: [listMcpTools, executeMcpTool]
---

# Video, voice and music

Generations run on the \`${MEDIA_SERVER_NAME}\` MCP server, through \`executeMcpTool\`.

1. If you do not know the models yet, call \`list_models\`. Defaults: video \`seedance-mini\` (cheapest), \`veo-fast\` when the user wants higher quality, \`veo\` only when they ask for the best; voice \`gemini-voice\`; music \`lyria\` (\`lyria-pro\` for a full, polished song).
2. Call \`generate\` with \`model\` and \`prompt\`. For a voice, \`prompt\` is the exact text to read, in the user's language. For a video, write a vivid visual description; pass \`duration\` or \`aspect_ratio: "9:16"\` (phone/story format) only when the user asks.
3. Tell the user it has started and usually takes 1 to 5 minutes, then call \`check\` with the id, again and again while it says it is still running.
4. When ready, show the saved path to the user in a \`\`\`filepath code block.

Each generation is paid from the user's media credits when it starts, and refunded if it fails; \`list_models\` gives each model's price and the balance. Before a video, tell the user its price in credits. Generate once per request; never retry a successful one, and never start several variants unless asked. If \`generate\` reports \`insufficient_media_credits\`, say plainly what it costs and what is left, and offer a cheaper model, a shorter duration, or buying a media credit pack.
`;

/** Far future: the control plane rotates the token, core must never try to refresh it. */
export const NEVER_EXPIRES = 4_102_444_800; // 2100-01-01

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

/** rowboat-server's lock in the workdir (apps/server/src/lock.ts LOCK_FILE). */
export const SERVER_LOCK = 'server.lock';

export async function seedWorkdir(opts: SeedOptions): Promise<void> {
  const config = path.join(opts.workDir, 'config');

  // The server's lock (apps/server/src/lock.ts) outlives a machine stopped
  // hard, and its pid can be some other process after the reboot: the
  // server then refuses /data and the machine never comes back. Seeding
  // runs once per boot, before the server, so any lock here is stale.
  await fs.rm(path.join(opts.workDir, SERVER_LOCK), { force: true });

  // Loopback only: the gate is the one door (gate.ts).
  const serverFile = path.join(config, 'server.json');
  const server = (await readJson(serverFile)) ?? {};
  await writeJson(serverFile, { ...server, lanEnabled: false });

  // Where rowboat-server reads its key (apps/server/src/auth.ts,
  // SERVER_KEY_FILE): rewritten on every boot, the control plane owns it.
  if (opts.serverKey) {
    await fs.mkdir(opts.workDir, { recursive: true });
    const keyFile = path.join(opts.workDir, 'server-key');
    await fs.writeFile(keyFile, opts.serverKey + '\n', { mode: 0o600 });
    // `mode` only applies to a new file.
    await fs.chmod(keyFile, 0o600);
  }

  // The `rowboat` session is how core authenticates to API_URL
  // (core auth/tokens.ts getAccessToken): here, the control plane.
  const oauthFile = path.join(config, 'oauth.json');
  const oauth = (await readJson(oauthFile)) ?? {};
  const providers = (oauth.providers && typeof oauth.providers === 'object' ? oauth.providers : {}) as Record<string, unknown>;
  await writeJson(oauthFile, {
    ...oauth,
    version: 2,
    providers: {
      ...providers,
      rowboat: {
        mode: 'rowboat',
        tokens: { access_token: opts.instanceToken, refresh_token: null, expires_at: NEVER_EXPIRES, token_type: 'Bearer' },
      },
    },
  });

  // The upstream onboarding does not fit an instance: models come from the
  // control plane, and its last step demands a team space, which fails
  // while no Spaces server exists (measured 01/10/2026, architecture §6).
  // Marked done; Baarali's own onboarding (phone login) replaces it.
  const noteFile = path.join(config, 'note_creation.json');
  const note = (await readJson(noteFile)) ?? { strictness: 'medium', configured: false };
  if (note.onboardingComplete !== true) {
    await writeJson(noteFile, { ...note, onboardingComplete: true });
  }

  if (opts.mediaServer) {
    const mcpFile = path.join(config, 'mcp.json');
    const mcp = (await readJson(mcpFile)) ?? {};
    const servers = (mcp.mcpServers && typeof mcp.mcpServers === 'object' ? mcp.mcpServers : {}) as Record<string, unknown>;
    // Otherwise the agent would see the same tools twice, under both names.
    delete servers[FORMER_MEDIA_NAME];
    await fs.rm(path.join(opts.workDir, 'skills', FORMER_MEDIA_NAME), { recursive: true, force: true });
    await writeJson(mcpFile, { ...mcp, mcpServers: { ...servers, [MEDIA_SERVER_NAME]: { type: 'stdio', ...opts.mediaServer } } });
    const skillDir = path.join(opts.workDir, 'skills', MEDIA_SKILL_DIR);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), MEDIA_SKILL);
  }

  // Initial model choice only; a choice already made is never overwritten.
  const modelsFile = path.join(config, 'models.json');
  const models = (await readJson(modelsFile)) ?? { version: 2, providers: {} };
  if (!models.assistantModel) {
    await writeJson(modelsFile, {
      ...models,
      version: 2,
      providers: models.providers ?? {},
      assistantModel: { provider: 'rowboat', model: opts.assistantModel },
    });
  }

  // The Chat codes on this machine, which is the account's alone (03/10/2026):
  // building and checking a project runs these without asking each time.
  // Anything else (rm, an unknown tool) still asks. The person's own
  // additions are kept; ours come back if removed, on every boot.
  const securityFile = path.join(config, 'security.json');
  let security: unknown = null;
  try {
    security = JSON.parse(await fs.readFile(securityFile, 'utf8'));
  } catch {
    // none yet: core's defaults, then ours
  }
  const current: string[] = Array.isArray(security)
    ? security.filter((c): c is string => typeof c === 'string')
    : security && typeof security === 'object' && Array.isArray((security as { allowedCommands?: unknown }).allowedCommands)
      ? ((security as { allowedCommands: unknown[] }).allowedCommands.filter((c): c is string => typeof c === 'string'))
      : CORE_ALLOWED_COMMANDS;
  const allowed = [...new Set([...current, ...BUILD_COMMANDS])];
  if (allowed.length !== current.length || security === null) {
    await writeJson(
      securityFile,
      Array.isArray(security) || security === null ? allowed : { ...(security as Record<string, unknown>), allowedCommands: allowed },
    );
  }

  // HOME lives on the volume (Dockerfile): created on the first boot, with a
  // git identity so the Chat's commits work; one the person set is kept.
  const home = process.env.HOME;
  if (home && home.startsWith(opts.workDir)) {
    await fs.mkdir(home, { recursive: true });
    const gitconfig = path.join(home, '.gitconfig');
    try {
      await fs.access(gitconfig);
    } catch {
      await fs.writeFile(gitconfig, '[user]\n\tname = Baarali\n\temail = baarali@localhost\n[init]\n\tdefaultBranch = main\n');
    }
  }

  // Room for a real project in one message: 150 model calls in a chat turn
  // instead of 50 (the quota still counts every one). Set once; a limit the
  // person chose is theirs.
  const limitsFile = path.join(config, 'turn_limits.json');
  if (!(await readJson(limitsFile))) {
    await writeJson(limitsFile, { maxModelCalls: 50, chatMaxModelCalls: 150 });
  }
}

/** core config/security.ts DEFAULT_ALLOW_LIST, used when the file does not exist yet. */
export const CORE_ALLOWED_COMMANDS = [
  'agent-slack', 'awk', 'basename', 'cat', 'cut', 'date', 'df', 'diff', 'dirname', 'du', 'echo', 'env', 'file',
  'find', 'grep', 'head', 'hostname', 'jq', 'ls', 'printenv', 'printf', 'pwd', 'readlink', 'realpath', 'sort',
  'stat', 'tail', 'tree', 'uname', 'uniq', 'wc', 'which', 'whoami', 'yq',
];

/** What building and checking a project takes (git, node, python and the plain file tools). */
export const BUILD_COMMANDS = [
  'git', 'node', 'npm', 'npx', 'pnpm', 'yarn', 'corepack', 'tsc', 'vite',
  'python', 'python3', 'pip', 'pip3',
  'mkdir', 'touch', 'cp', 'mv', 'ln', 'sed', 'tee', 'xargs', 'tar', 'unzip', 'zip', 'gzip', 'gunzip',
  'cd', 'test', 'true', 'false', 'sleep', 'chmod', 'curl', 'wget', 'base64', 'sha256sum', 'md5sum',
];
