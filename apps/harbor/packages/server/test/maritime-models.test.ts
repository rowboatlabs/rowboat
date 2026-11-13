import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MARITIME_ENV, RUNTIMES } from '../src/connectors/maritime/runtimes.js';

// Model lists come from the harness (2026-11-01), in a separate execution after the turn is settled.
// The runtime reads them into the composer's choices, and nothing is listed in Harbor itself.
const input = { serverUrl: 'http://localhost:1', agentKey: 'rbk_x', promptPath: '/p', outPath: '/o.jsonl', errPath: '/e.err', lastPath: '/l' };
const EFFORT = { type: 'select', key: 'effort', label: 'Effort', choices: [{ id: 'low', label: 'Low' }, { id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }] };

describe('model lists from the harness', () => {
  it('keeps catalogue work out of every turn script, while preserving each runtime’s catalogue source', () => {
    for (const runtime of Object.values(RUNTIMES)) {
      expect(runtime.command(input)).not.toContain(`${runtime.root}/rowboat/models.json`);
      expect(runtime.command(input)).not.toContain('provider_model_ids');
      expect(runtime.modelsCommand()).toContain(`${runtime.root}/rowboat/models.json`);
    }
    const codex = RUNTIMES.codex!.modelsCommand();
    expect(codex).toContain('models_cache.json');
    expect(codex).toContain('"$OPENAI_BASE_URL/models"');
    const claude = RUNTIMES['claude-code']!.modelsCommand();
    expect(claude).toContain('/v1/models?limit=100');
    expect(claude).toContain('${ANTHROPIC_BASE_URL:-https://api.anthropic.com}');
    const hermes = RUNTIMES.hermes!.modelsCommand();
    expect(hermes).toContain('provider_model_ids');
    expect(hermes).toContain('HERMES_HOME=/opt/data HOME=/opt/data');
  });

  it('Codex’s catalog: listed models by priority, hidden ones left out; a plain models endpoint too', () => {
    const codex = RUNTIMES.codex!;
    expect(
      codex.models(
        JSON.stringify({
          fetched_at: 1,
          models: [
            { slug: 'gpt-6-sol', display_name: 'GPT-6-Sol', visibility: 'list', priority: 4 },
            { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list', priority: 1 },
            { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', priority: 2 },
            { slug: '', visibility: 'list' },
          ],
        }),
      ),
    ).toEqual([
      { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' },
      { id: 'gpt-6-sol', label: 'GPT-6-Sol' },
    ]);
    expect(codex.models(JSON.stringify({ object: 'list', data: [{ id: 'b-model' }, { id: 'a-model' }] }))).toEqual([
      { id: 'a-model', label: 'a-model' },
      { id: 'b-model', label: 'b-model' },
    ]);
    expect(codex.models('not json')).toEqual([]);
    expect(codex.models('{"models": "nope"}')).toEqual([]);
  });

  it('Anthropic’s models endpoint for Claude Code, Hermes’s own catalog for Hermes', () => {
    expect(RUNTIMES['claude-code']!.models(JSON.stringify({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-haiku-5-5' }, { type: 'model' }] }))).toEqual([
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-haiku-5-5', label: 'claude-haiku-5-5' },
    ]);
    expect(RUNTIMES.hermes!.models(JSON.stringify({ provider: 'openrouter', models: ['anthropic/claude-sonnet-5-5', 7, ''] }))).toEqual([{ id: 'anthropic/claude-sonnet-5-5', label: 'anthropic/claude-sonnet-5-5' }]);
  });

  it('the Model option exists only when there is a choice, ahead of the runtime’s own options', () => {
    expect(RUNTIMES.codex!.options([])).toEqual([EFFORT]);
    expect(RUNTIMES.codex!.options([{ id: 'only', label: 'Only' }]).map((o) => o.key)).toEqual(['effort']);
    expect(RUNTIMES['claude-code']!.options([])).toEqual([]);
    expect(RUNTIMES['claude-code']!.options([{ id: 'a', label: 'A' }, { id: 'b', label: '' }])).toEqual([
      { type: 'select', key: 'model', label: 'Model', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'b' }] },
    ]);
    expect(RUNTIMES.hermes!.options([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]).map((o) => o.key)).toEqual(['model', 'effort']);
    // More than the protocol takes is cut, not refused.
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, label: `M${i}` }));
    const option = RUNTIMES.codex!.options(many)[0]!;
    expect(option.type === 'select' ? option.choices.length : 0).toBe(100);
  });
});

describe('a turn that stops without a word', () => {
  // Seen 2026-11-13: a command that exits non-zero before its runtime writes anything (an exec right after a wake)
  // left an empty failure, which read as success, and the thread got "Finished on Maritime." five times in two days.
  it.each(Object.entries(RUNTIMES))('%s names the exit code instead of passing as a success', (_kind, runtime) => {
    for (const err of [undefined, '', '\n']) {
      const reading = runtime.read('', undefined, err, 1);
      expect(reading.answer).toBeUndefined();
      expect(reading.failure).toMatch(/exit code 1/);
    }
    expect(runtime.read('', undefined, 'boom: no such file', 2).failure).toBe('boom: no such file');
  });
});

describe('Maritime’s environment file', () => {
  // Maritime writes /etc/maritime-env from bash (`export -p`: `declare -x NAME="value"` lines) and the turn runs
  // under sh, dash on every box. Sourcing it as is killed every turn with exit 127 from 2026-11-11 to 11-13, and
  // in dash a syntax error inside `eval` ends the shell outright, so each line is checked before it is evaluated.
  const shells = ['sh', ...(['/bin/dash', '/usr/bin/dash'].filter((p) => existsSync(p)))];
  it.each(shells)('is loaded by %s with its bash syntax turned into exports, skipping what cannot be taken', (shell) => {
    const dir = mkdtempSync(join(tmpdir(), 'maritime-env-'));
    const file = join(dir, 'maritime-env');
    writeFileSync(file, [
      'declare -x CC="gcc"',
      'declare -x QUOTED="a \\"b\\" \\$c"',
      'declare -x EMPTY=""',
      'declare -x BARE',
      'declare -x BROKEN="unterminated',
      'declare -x 1BAD="x"',
      "declare -x WEIRD=$'line\\nbreak'",
      'export PLAIN="old style"',
      '',
    ].join('\n'));
    const script = `set -e; ${MARITIME_ENV.replaceAll('/etc/maritime-env', file)}; printf '%s|%s|%s|%s|%s' "$CC" "$QUOTED" "$EMPTY" "$PLAIN" "\${BROKEN:-unset}"; env | grep -c '^1BAD=' || true`;
    const out = execFileSync(shell, ['-c', script], { encoding: 'utf8' });
    expect(out).toBe('gcc|a "b" $c||old style|unset0\n');
  });

  it('is what every runtime’s turn runs first', () => {
    for (const runtime of Object.values(RUNTIMES)) {
      const script = runtime.command({ serverUrl: 'https://h.test', agentKey: 'rbk_x', promptPath: '/data/rowboat/p', outPath: '/data/rowboat/o', errPath: '/data/rowboat/e', lastPath: '/data/rowboat/l' });
      expect(script).toContain(MARITIME_ENV);
      expect(script).not.toContain('then . /etc/maritime-env');
    }
  });
});

