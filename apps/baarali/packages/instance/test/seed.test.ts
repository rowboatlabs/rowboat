import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_COMMANDS, CORE_ALLOWED_COMMANDS, IMAGE_MODEL, IMAGES_SKILL, MEDIA_SKILL, NEVER_EXPIRES, SERVER_LOCK, seedWorkdir } from '../src/seed.js';

async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), 'baarali-seed-')); }
const read = async (dir: string, f: string) => JSON.parse(await fs.readFile(path.join(dir, 'config', f), 'utf8'));

describe('seedWorkdir', () => {
  it('prepares an empty workdir: loopback server, control-plane session, initial model', async () => {
    const dir = await tmp();
    await seedWorkdir({ workDir: dir, instanceToken: 't1', assistantModel: 'deepseek/deepseek-v4.1-flash' });
    expect(await read(dir, 'server.json')).toEqual({ lanEnabled: false });
    expect((await read(dir, 'oauth.json')).providers.rowboat).toEqual({
      mode: 'rowboat',
      tokens: { access_token: 't1', refresh_token: null, expires_at: NEVER_EXPIRES, token_type: 'Bearer' },
    });
    expect(await read(dir, 'models.json')).toEqual({
      version: 2,
      providers: {},
      assistantModel: { provider: 'rowboat', model: 'deepseek/deepseek-v4.1-flash' },
      // Without it core never offers the agent its image tool (05/10/2026).
      imageModel: { provider: 'rowboat', model: IMAGE_MODEL },
    });
    expect((await fs.stat(path.join(dir, 'config', 'oauth.json'))).mode & 0o777).toBe(0o600);
    expect(await read(dir, 'note_creation.json')).toEqual({ strictness: 'medium', configured: false, onboardingComplete: true });
  });

  it('drops the lock a machine stopped hard left behind, so the server starts again', async () => {
    const dir = await tmp();
    // pid 1 is always alive: the server would take this lock for a live holder.
    await fs.writeFile(path.join(dir, SERVER_LOCK), '1');
    await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm' });
    await expect(fs.access(path.join(dir, SERVER_LOCK))).rejects.toThrow();
  });

  it('writes the server key the control plane gives, and leaves the minted one otherwise', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 'server-key'), 'minted\n');
    await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm' });
    expect(await fs.readFile(path.join(dir, 'server-key'), 'utf8')).toBe('minted\n');
    await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm', serverKey: 'from-control' });
    expect(await fs.readFile(path.join(dir, 'server-key'), 'utf8')).toBe('from-control\n');
    expect((await fs.stat(path.join(dir, 'server-key'))).mode & 0o777).toBe(0o600);
  });

  it('marks the upstream onboarding done without touching the note settings', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, 'config'));
    await fs.writeFile(path.join(dir, 'config', 'note_creation.json'), JSON.stringify({ strictness: 'high', configured: true }));
    await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm' });
    expect(await read(dir, 'note_creation.json')).toEqual({ strictness: 'high', configured: true, onboardingComplete: true });
  });

  it('keeps what the person chose and rewrites only the control-plane session', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, 'config'));
    await fs.writeFile(path.join(dir, 'config', 'oauth.json'), JSON.stringify({ version: 2, providers: { google: { tokens: null, clientId: 'g' }, rowboat: { tokens: { access_token: 'old' } } } }));
    await fs.writeFile(path.join(dir, 'config', 'models.json'), JSON.stringify({ version: 2, providers: {}, assistantModel: { provider: 'rowboat', model: 'anthropic/claude-sonnet-5.5' } }));
    await fs.writeFile(path.join(dir, 'config', 'server.json'), JSON.stringify({ lanEnabled: true, port: 3220 }));
    await seedWorkdir({ workDir: dir, instanceToken: 't2', assistantModel: 'deepseek/deepseek-v4.1-flash' });
    const oauth = await read(dir, 'oauth.json');
    expect(oauth.providers.google).toEqual({ tokens: null, clientId: 'g' });
    expect(oauth.providers.rowboat.tokens.access_token).toBe('t2');
    expect((await read(dir, 'models.json')).assistantModel.model).toBe('anthropic/claude-sonnet-5.5');
    // An instance made before 05/10/2026 gets the image model it lacked, once.
    expect((await read(dir, 'models.json')).imageModel).toEqual({ provider: 'rowboat', model: IMAGE_MODEL });
    const models = await read(dir, 'models.json');
    await fs.writeFile(path.join(dir, 'config', 'models.json'), JSON.stringify({ ...models, imageModel: { provider: 'rowboat', model: 'openai/gpt-image-1' } }));
    await seedWorkdir({ workDir: dir, instanceToken: 't3', assistantModel: 'deepseek/deepseek-v4.1-flash' });
    expect((await read(dir, 'models.json')).imageModel.model).toBe('openai/gpt-image-1');
    expect(await read(dir, 'server.json')).toEqual({ lanEnabled: false, port: 3220 });
  });

  it('registers the media server and its skill, keeping the person\'s own servers', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, 'config'));
    await fs.writeFile(path.join(dir, 'config', 'mcp.json'), JSON.stringify({ mcpServers: { mine: { url: 'https://x.test' }, 'baarali-media': { command: 'old' } } }));
    const mediaServer = { command: '/usr/bin/node', args: ['/app/instance/dist/media-mcp-main.js'], env: { ROWBOAT_WORKDIR: dir, API_URL: 'https://c.test' } };
    await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm', mediaServer });
    expect(await read(dir, 'mcp.json')).toEqual({ mcpServers: { mine: { url: 'https://x.test' }, 'baarali-media': { type: 'stdio', ...mediaServer } } });
    const skill = await fs.readFile(path.join(dir, 'skills', 'baarali-media', 'SKILL.md'), 'utf8');
    expect(skill).toBe(MEDIA_SKILL);
    // Images go to core's own tool, attached alone.
    const images = await fs.readFile(path.join(dir, 'skills', 'baarali-images', 'SKILL.md'), 'utf8');
    expect(images).toBe(IMAGES_SKILL);
    expect(images).toMatch(/^---\nname: Images\n[\s\S]*\ntools: \[generate-image\]\n---\n/);
    expect(images).toContain('`generate-image`');
    expect(skill).toMatch(/^---\nname: .+\ndescription: .+\ntools: \[listMcpTools, executeMcpTool\]\n---/);
    expect(skill).toContain('`baarali-media` MCP server');
    // No secret in mcp.json: the server reads the session from oauth.json.
    expect(JSON.stringify(await read(dir, 'mcp.json'))).not.toContain('"t"');
  });

  it('removes the media server and skill left under the former name', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, 'config'));
    await fs.mkdir(path.join(dir, 'skills', 'warell-media'), { recursive: true });
    await fs.writeFile(path.join(dir, 'skills', 'warell-media', 'SKILL.md'), 'old');
    await fs.writeFile(path.join(dir, 'config', 'mcp.json'), JSON.stringify({ mcpServers: { 'warell-media': { command: 'old' } } }));
    const mediaServer = { command: 'node', args: ['m.js'], env: {} };
    await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm', mediaServer });
    expect(Object.keys((await read(dir, 'mcp.json')).mcpServers as object)).toEqual(['baarali-media']);
    await expect(fs.access(path.join(dir, 'skills', 'warell-media'))).rejects.toThrow();
  });

  it('lets the Chat build a project without asking each time, and keeps the person\'s own commands', async () => {
    const dir = await tmp();
    await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm' });
    const first = await read(dir, 'security.json');
    expect(first).toEqual(expect.arrayContaining([...CORE_ALLOWED_COMMANDS, ...BUILD_COMMANDS]));
    expect(first).not.toContain('rm');
    await fs.writeFile(path.join(dir, 'config', 'security.json'), JSON.stringify(['ls', 'ffmpeg']));
    await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm' });
    const again = await read(dir, 'security.json');
    expect(again).toEqual(expect.arrayContaining(['ls', 'ffmpeg', 'git', 'npm', 'python3']));
  });

  it('gives a chat turn room for a real project, once', async () => {
    const dir = await tmp();
    await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm' });
    expect(await read(dir, 'turn_limits.json')).toEqual({ maxModelCalls: 50, chatMaxModelCalls: 150 });
    await fs.writeFile(path.join(dir, 'config', 'turn_limits.json'), JSON.stringify({ maxModelCalls: 20 }));
    await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm' });
    expect(await read(dir, 'turn_limits.json')).toEqual({ maxModelCalls: 20 });
  });

  it('makes HOME on the volume with a git identity, keeping one already there', async () => {
    const dir = await tmp();
    const before = process.env.HOME;
    process.env.HOME = path.join(dir, 'home');
    try {
      await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm' });
      expect(await fs.readFile(path.join(dir, 'home', '.gitconfig'), 'utf8')).toContain('name = Baarali');
      await fs.writeFile(path.join(dir, 'home', '.gitconfig'), '[user]\n\tname = Awa\n');
      await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm' });
      expect(await fs.readFile(path.join(dir, 'home', '.gitconfig'), 'utf8')).toContain('Awa');
    } finally {
      process.env.HOME = before;
    }
  });
});
