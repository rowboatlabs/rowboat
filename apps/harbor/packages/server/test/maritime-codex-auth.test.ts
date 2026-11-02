import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUNTIMES } from '../src/connectors/maritime/runtimes.js';

describe('Codex account runtime', () => {
  it.each(['chatgpt', 'openai'])('runs with the intended credentials for %s', (provider) => {
    const dir = mkdtempSync(join(tmpdir(), 'rowboat-codex-'));
    try {
      writeFileSync(join(dir, 'codex'), '#!/bin/sh\nprintf "%s\\n" "${OPENAI_API_KEY-unset}" "${OPENAI_BASE_URL-unset}" "${CODEX_API_KEY-unset}" "${CODEX_ACCESS_TOKEN-unset}" "$@"\n', { mode: 0o700 });
      const promptPath = join(dir, 'turn.prompt');
      const outPath = join(dir, 'turn.jsonl');
      writeFileSync(promptPath, 'hello');
      const command = RUNTIMES.codex!.command({
        orgUrl: 'https://example.test', agentKey: 'rbk_test', promptPath, outPath,
        lastPath: join(dir, 'turn.last'), errPath: join(dir, 'turn.err'),
      }).replaceAll('/data', dir);
      execFileSync('sh', ['-c', command], { env: {
        ...process.env, PATH: `${dir}:${process.env.PATH}`, ROWBOAT_LLM_PROVIDER: provider,
        OPENAI_API_KEY: 'proxy-secret', OPENAI_BASE_URL: 'https://proxy.invalid',
        CODEX_API_KEY: 'other-key', CODEX_ACCESS_TOKEN: 'other-token',
      } });
      const output = readFileSync(outPath, 'utf8');
      if (provider === 'chatgpt') {
        expect(output.startsWith('unset\nunset\nunset\nunset\n')).toBe(true);
        expect(output).toContain('forced_login_method="chatgpt"');
        expect(output).toContain('cli_auth_credentials_store="file"');
      } else expect(output.startsWith('proxy-secret\nhttps://proxy.invalid\n')).toBe(true);
      expect(output).toContain('model_provider="openai"');
      expect(output).toContain('mcp_servers.rowboat.bearer_token_env_var="ROWBOAT_AGENT_KEY"');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
