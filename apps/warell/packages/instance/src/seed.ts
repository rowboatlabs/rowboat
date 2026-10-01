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
  /** Model used until the person picks one, as an OpenRouter id. */
  assistantModel: string;
  /** How rowboat-server starts the media MCP server (media-mcp-main.ts). */
  mediaServer?: { command: string; args: string[]; env: Record<string, string> };
}

/** Our entries in the person's MCP config and skills; rewritten on every boot, the rest is theirs. */
export const MEDIA_SERVER_NAME = 'warell-media';
export const MEDIA_SKILL_DIR = 'warell-media';

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

export async function seedWorkdir(opts: SeedOptions): Promise<void> {
  const config = path.join(opts.workDir, 'config');

  // Loopback only: the gate is the one door (gate.ts).
  const serverFile = path.join(config, 'server.json');
  const server = (await readJson(serverFile)) ?? {};
  await writeJson(serverFile, { ...server, lanEnabled: false });

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
  // Marked done; Warell's own onboarding (phone login) replaces it.
  const noteFile = path.join(config, 'note_creation.json');
  const note = (await readJson(noteFile)) ?? { strictness: 'medium', configured: false };
  if (note.onboardingComplete !== true) {
    await writeJson(noteFile, { ...note, onboardingComplete: true });
  }

  if (opts.mediaServer) {
    const mcpFile = path.join(config, 'mcp.json');
    const mcp = (await readJson(mcpFile)) ?? {};
    const servers = (mcp.mcpServers && typeof mcp.mcpServers === 'object' ? mcp.mcpServers : {}) as Record<string, unknown>;
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
}
