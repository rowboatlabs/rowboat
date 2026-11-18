import { describe, expect, it } from 'vitest';
import { RUNTIMES } from '../src/connectors/maritime/runtimes.js';

// A current Claude Code on a Maritime VM (2026-11-13): the template's 2.1.150
// was refused newer models by the API ("version 2.1.280 or newer is required").

const claude = RUNTIMES['claude-code']!;
const files = { promptPath: '/data/rowboat/p', outPath: '/data/rowboat/o', errPath: '/data/rowboat/e', lastPath: '/data/rowboat/l' };

describe('Claude Code on Maritime', () => {
  it('installs a current Claude Code on the volume and runs it before the template’s own', () => {
    const script = claude.command({ serverUrl: 'https://spaces.example', agentKey: 'rbk_x', model: 'claude-opus-5-5', ...files });
    const install = script.indexOf('npm install --prefix /data/rowboat/claude-code ');
    const ours = script.indexOf('CLI=/data/rowboat/claude-code/node_modules/.bin/claude');
    const template = script.indexOf('command -v claude');
    expect(install).toBeGreaterThan(-1);
    expect(script).toContain('@anthropic-ai/claude-code@latest');
    expect(install).toBeLessThan(ours);
    expect(ours).toBeLessThan(template);
  });

  it('renews it daily after a turn, staged beside the live one and swapped in', () => {
    const script = claude.modelsCommand();
    expect(script).toContain('-mmin +1440');
    expect(script).toContain('npm install --prefix /data/rowboat/claude-code.new');
    expect(script).toContain('mv /data/rowboat/claude-code.new /data/rowboat/claude-code');
    expect(script).toMatch(/&\nfi/); // in the background: the catalogue refresh is not held up
  });

  it('says a refused model once, as the failure, not again as the answer', () => {
    const error = 'API Error: 400 Claude Code 2.1.150 does not support this model; version 2.1.280 or newer is required.';
    const out = [
      { type: 'assistant', message: { content: [{ type: 'text', text: error }] }, parent_tool_use_id: null },
      { type: 'result', subtype: 'success', is_error: true, result: error, session_id: 's1' },
    ].map((e) => JSON.stringify(e)).join('\n');
    expect(claude.read(out, undefined, '', 1)).toEqual({ failure: error, session: 's1' });
  });
});
