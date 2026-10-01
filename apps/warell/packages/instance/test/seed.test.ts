import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEDIA_SKILL, NEVER_EXPIRES, seedWorkdir } from '../src/seed.js';

async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), 'warell-seed-')); }
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
    expect(await read(dir, 'models.json')).toEqual({ version: 2, providers: {}, assistantModel: { provider: 'rowboat', model: 'deepseek/deepseek-v4.1-flash' } });
    expect((await fs.stat(path.join(dir, 'config', 'oauth.json'))).mode & 0o777).toBe(0o600);
    expect(await read(dir, 'note_creation.json')).toEqual({ strictness: 'medium', configured: false, onboardingComplete: true });
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
    expect(await read(dir, 'server.json')).toEqual({ lanEnabled: false, port: 3220 });
  });

  it('registers the media server and its skill, keeping the person\'s own servers', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, 'config'));
    await fs.writeFile(path.join(dir, 'config', 'mcp.json'), JSON.stringify({ mcpServers: { mine: { url: 'https://x.test' }, 'warell-media': { command: 'old' } } }));
    const mediaServer = { command: '/usr/bin/node', args: ['/app/instance/dist/media-mcp-main.js'], env: { ROWBOAT_WORKDIR: dir, API_URL: 'https://c.test' } };
    await seedWorkdir({ workDir: dir, instanceToken: 't', assistantModel: 'm', mediaServer });
    expect(await read(dir, 'mcp.json')).toEqual({ mcpServers: { mine: { url: 'https://x.test' }, 'warell-media': { type: 'stdio', ...mediaServer } } });
    const skill = await fs.readFile(path.join(dir, 'skills', 'warell-media', 'SKILL.md'), 'utf8');
    expect(skill).toBe(MEDIA_SKILL);
    expect(skill).toMatch(/^---\nname: .+\ndescription: .+\ntools: \[listMcpTools, executeMcpTool\]\n---/);
    expect(skill).toContain('`warell-media` MCP server');
    // No secret in mcp.json: the server reads the session from oauth.json.
    expect(JSON.stringify(await read(dir, 'mcp.json'))).not.toContain('"t"');
  });
});
