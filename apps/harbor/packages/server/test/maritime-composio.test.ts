import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RUNTIMES } from '../src/connectors/maritime/runtimes.js';

// 2026-11-11: execute the actual turn scripts with CLI stand-ins. This catches
// shell quoting and resume/config behavior that string assertions miss.
const ENDPOINT = 'https://api.rowboat.test/v1/composio/mcp';
const KEY = 'rbg_composio_identity';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

function turn(kind: string, services: boolean, session?: string, dir?: string) {
  const root = dir ?? mkdtempSync(join(tmpdir(), 'maritime-composio-'));
  if (!dir) dirs.push(root);
  mkdirSync(join(root, 'bin'), { recursive: true });
  mkdirSync(join(root, 'skills/rowboat-spaces'), { recursive: true });
  const capture = join(root, 'calls.jsonl');
  writeFileSync(capture, '');
  const stub = `#!${process.execPath}
const fs = require('node:fs');
const name = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CAPTURE, JSON.stringify({ name, args }) + '\\n');
if (name === 'hermes' && args[0] === 'config' && args[1] === 'set') {
  const [key, value] = args.slice(2);
  const env = /^[A-Z_]+$/.test(key);
  fs.appendFileSync(process.env.HERMES_HOME + (env ? '/.env' : '/config.yaml'), key + (env ? '=' : ': ') + value + '\\n');
} else if (name === 'codex' && args[0] === 'login') {
  console.log('Logged in using ChatGPT');
} else {
  console.log(JSON.stringify({ type: 'result', exit_code: 0, text: 'Done.' }));
}
`;
  for (const name of ['hermes', 'codex', 'claude']) {
    const path = join(root, 'bin', name);
    writeFileSync(path, stub);
    chmodSync(path, 0o755);
  }
  writeFileSync(join(root, 'request.prompt'), 'List calendar events.');
  const script = RUNTIMES[kind]!.command({
    serverUrl: 'https://spaces.rowboat.test', agentKey: 'rbk_spaces_identity',
    promptPath: join(root, 'request.prompt'), outPath: join(root, 'turn.jsonl'),
    errPath: join(root, 'turn.err'), lastPath: join(root, 'turn.last'), ...(session ? { session } : {}),
  }).replaceAll('/opt/data', root).replaceAll('/data', root);
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, CAPTURE: capture,
    ROWBOAT_LLM_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'sk_or_own_model', ROWBOAT_LLM_MODEL: '',
  };
  delete env.ROWBOAT_COMPOSIO_MCP_URL;
  delete env.ROWBOAT_GATEWAY_KEY;
  if (services) Object.assign(env, { ROWBOAT_COMPOSIO_MCP_URL: ENDPOINT, ROWBOAT_GATEWAY_KEY: KEY });
  execFileSync('sh', ['-c', script], { env, stdio: 'pipe' });
  const calls = readFileSync(capture, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { name: string; args: string[] });
  return { root, calls };
}

describe('managed runtimes receive Composio independently of their model', () => {
  it('writes Hermes profile secrets and placeholder config, restoring them after a boot rewrite', () => {
    const first = turn('hermes', true);
    expect(readFileSync(join(first.root, '.env'), 'utf8')).toContain(`ROWBOAT_GATEWAY_KEY=${KEY}`);
    const config = readFileSync(join(first.root, 'config.yaml'), 'utf8');
    expect(config).toContain('mcp_servers.composio.url: ${ROWBOAT_COMPOSIO_MCP_URL}');
    expect(config).toContain('mcp_servers.composio.headers.Authorization: Bearer ${ROWBOAT_GATEWAY_KEY}');
    expect(config).not.toContain(KEY);
    writeFileSync(join(first.root, 'config.yaml'), '');
    const resumed = turn('hermes', true, 'existing-thread', first.root);
    expect(readFileSync(join(first.root, 'config.yaml'), 'utf8')).toContain('mcp_servers.composio.url: ${ROWBOAT_COMPOSIO_MCP_URL}');
    expect(resumed.calls.find(call => call.args[0] === 'chat')?.args).toContain('existing-thread');
  });

  it.each([undefined, 'existing-thread'])('passes valid TOML arguments to Codex on a new or resumed turn (%s)', session => {
    const { calls } = turn('codex', true, session);
    const args = calls.find(call => call.args[0] === 'exec')!.args;
    expect(args).toContain(`mcp_servers.composio.url="${ENDPOINT}"`);
    expect(args).toContain('mcp_servers.composio.bearer_token_env_var="ROWBOAT_GATEWAY_KEY"');
    expect(args).toContain('mcp_servers.rowboat.bearer_token_env_var="ROWBOAT_AGENT_KEY"');
    expect(args.join(' ')).not.toContain(KEY);
    if (session) expect(args.slice(1, 3)).toEqual(['resume', session]);
  });

  it.each([undefined, 'existing-thread'])('gives Claude Code both MCP servers using environment references (%s)', session => {
    const { root, calls } = turn('claude-code', true, session);
    const config = JSON.parse(readFileSync(join(root, 'rowboat/mcp.json'), 'utf8'));
    expect(config.mcpServers.rowboat.headers.Authorization).toBe('Bearer ${ROWBOAT_AGENT_KEY}');
    expect(config.mcpServers.composio).toEqual({
      type: 'http', url: '${ROWBOAT_COMPOSIO_MCP_URL}', headers: { Authorization: 'Bearer ${ROWBOAT_GATEWAY_KEY}' },
    });
    expect(JSON.stringify(config)).not.toContain(KEY);
    const args = calls.find(call => call.name === 'claude')!.args;
    expect(args).toContain('--mcp-config');
    if (session) expect(args.slice(args.indexOf('--resume') + 1, args.indexOf('--resume') + 2)).toEqual([session]);
  });

  it.each(['hermes', 'codex', 'claude-code'])('keeps unbilled %s turns free of an unconfigured Composio server', kind => {
    const { root, calls } = turn(kind, false);
    expect(calls.flatMap(call => call.args).some(arg => /^(mcp_servers\.composio\.|ROWBOAT_GATEWAY_KEY|ROWBOAT_COMPOSIO_MCP_URL)/.test(arg))).toBe(false);
    if (kind === 'claude-code') expect(Object.keys(JSON.parse(readFileSync(join(root, 'rowboat/mcp.json'), 'utf8')).mcpServers)).toEqual(['rowboat']);
  });
});
