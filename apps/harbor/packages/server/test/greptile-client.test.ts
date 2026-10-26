import { afterEach, describe, expect, it } from 'vitest';
import { GreptileApi, GreptileError } from '../src/connectors/greptile/client.js';
import { greptileIntegration, targetUrl } from '../src/connectors/greptile/index.js';
import { defaultGreptileReply, fakeGreptile, REPO, REVIEW } from './fake-greptile.js';

const fixtures: Awaited<ReturnType<typeof fakeGreptile>>[] = [];
async function fixture() { const f = await fakeGreptile(); fixtures.push(f); return f; }
afterEach(async () => { await Promise.all(fixtures.splice(0).map((f) => f.close())); });
function command(f: Awaited<ReturnType<typeof fakeGreptile>>, name: string, args: string, options = {}) {
  const integration = greptileIntegration({ endpoint: f.endpoint, ...options });
  return integration.commands.find((c) => c.name === name)!.run(integration.client('good'), args);
}
const PR = 'https://github.com/owner/repo/pull/42';

describe('Greptile MCP client and commands', () => {
  it('accepts composer autolinks while retaining URL validation', () => {
    expect(targetUrl(`<${PR}>`, true)).toEqual(targetUrl(PR, true));
    expect(targetUrl('<https://github.com/owner/repo>', false)).toEqual(targetUrl('https://github.com/owner/repo', false));
    expect(() => targetUrl('<https://evil.test/owner/repo/pull/42>', true)).toThrow();
    expect(() => targetUrl('<https://user:pass@github.com/owner/repo/pull/42>', true)).toThrow();
  });
  it.each(['json', 'sse', 'text'])('authenticates with a protected call and cleans up %s sessions', async (mode) => {
    const f = await fixture();
    if (mode === 'sse') f.useSse();
    if (mode === 'text') f.useText();
    await new GreptileApi('good', { endpoint: f.endpoint }).check();
    expect(f.calls.map((c) => c.name)).toEqual(['get_me', 'list_repositories']);
    expect(f.terminated).toBe(1);
    expect(f.calls.every((c) => c.key === 'Bearer good')).toBe(true);
  });
  it('accepts an empty catalog but rejects a user OAuth identity in the key flow', async () => {
    const f = await fixture();
    f.setRoute((c) => c.name === 'list_repositories' ? { data: { repositories: [], total: 0 } } : defaultGreptileReply(c));
    await new GreptileApi('good', { endpoint: f.endpoint }).check();
    f.setRoute(() => ({ data: { principal: { type: 'USER' }, organizations: [] } }));
    await expect(new GreptileApi('good', { endpoint: f.endpoint }).check()).rejects.toThrow('unexpected');
  });
  it.each([401, 403, 429, 500])('redacts HTTP %s errors and only rejects keys on 401', async (status) => {
    const f = await fixture();
    f.setRoute(() => ({ status, raw: 'SECRET_SENTINEL' }));
    const error = await command(f, 'repos', '').catch((e) => e);
    expect(error).toBeInstanceOf(GreptileError);
    expect(error.message).not.toContain('SECRET_SENTINEL');
    expect(error.rejectsKey).toBe(status === 401);
  });
  it('treats HTTP 200 tool errors as failures without leaking their bodies', async () => {
    const f = await fixture();
    f.setRoute(() => ({ toolError: true, data: { error: 'SECRET_SENTINEL' } }));
    await expect(command(f, 'repos', '')).rejects.toThrow('could not perform');
  });
  it('uses the discovered branch and requests a review once, with no polling', async () => {
    const f = await fixture();
    expect(await command(f, 'review', PR)).toContain('has not finished');
    expect(f.calls.map((c) => c.name)).toEqual(['list_repositories', 'trigger_code_review']);
    expect(f.calls[1]!.args).toEqual({ name: REPO.name, remote: 'github', defaultBranch: 'develop', prNumber: 42 });
  });
  it.each(['timeout', '500', 'invalid', 'tool-error'])('never replays an uncertain trigger after %s', async (mode) => {
    const f = await fixture();
    f.setRoute((c) => c.name !== 'trigger_code_review' ? defaultGreptileReply(c)
      : mode === 'timeout' ? { delay: 150, data: { success: true } }
      : mode === '500' ? { status: 500, raw: 'SECRET_SENTINEL' }
      : mode === 'invalid' ? { raw: '{invalid' } : { toolError: true, data: { error: 'SECRET_SENTINEL' } });
    await expect(command(f, 'review', PR, { timeoutMs: 100 })).rejects.toThrow('may have been accepted');
    expect(f.calls.filter((c) => c.name === 'trigger_code_review')).toHaveLength(1);
  });
  it.each([401, 403, 429])('preserves known trigger rejection %s without retrying', async (status) => {
    const f = await fixture();
    f.setRoute((c) => c.name === 'trigger_code_review' ? { status, raw: 'SECRET_SENTINEL' } : defaultGreptileReply(c));
    const error = await command(f, 'review', PR).catch((e) => e);
    expect(error.rejectsKey).toBe(status === 401);
    expect(error.message).not.toContain('SECRET_SENTINEL');
    expect(f.calls.filter((c) => c.name === 'trigger_code_review')).toHaveLength(1);
  });
  it('does not trigger disabled repositories', async () => {
    const f = await fixture();
    f.setRoute(() => ({ data: { repositories: [{ ...REPO, reviewsEnabled: false }], total: 1 } }));
    await expect(command(f, 'review', PR)).rejects.toThrow('disabled');
    expect(f.calls).toHaveLength(1);
  });
  it('distinguishes no match, ambiguous match, and exhausted catalog lookup', async () => {
    const f = await fixture();
    f.setRoute(() => ({ data: { repositories: [], total: 0 } }));
    await expect(command(f, 'status', PR)).rejects.toThrow('not available');
    f.setRoute(() => ({ data: { repositories: [REPO, REPO], total: 2 } }));
    await expect(command(f, 'status', PR)).rejects.toThrow('ambiguous');
    f.setRoute(() => ({ data: { repositories: Array.from({ length: 100 }, () => ({ ...REPO, name: 'other/repo' })), total: 2000 } }));
    const start = f.calls.length;
    await expect(command(f, 'status', PR)).rejects.toThrow('exceeded');
    expect(f.calls.length - start).toBe(10);
  });
  it('selects the latest run without attributing an old summary to it', async () => {
    const f = await fixture();
    f.setRoute((c) => c.name === 'list_code_reviews' ? { data: { codeReviews: [REVIEW, { ...REVIEW, id: 'new', status: 'PENDING', createdAt: '2026-10-22T11:00:00Z' }] } } : defaultGreptileReply(c));
    const body = await command(f, 'status', PR);
    expect(body).toContain('Queued');
    expect(body).not.toContain('Review summary');
    expect(f.calls.some((c) => c.name === 'get_code_review')).toBe(false);
  });
  it('reads completed summaries, and handles empty, unknown, and truncated states', async () => {
    const f = await fixture();
    expect(await command(f, 'status', PR)).toContain('Review summary');
    for (const [reviews, expected] of [[[], 'No review visible'], [[{ ...REVIEW, status: 'FUTURE' }], 'Status: FUTURE']] as const) {
      f.setRoute((c) => c.name === 'list_code_reviews' ? { data: { codeReviews: reviews } } : defaultGreptileReply(c));
      expect(await command(f, 'status', PR)).toContain(expected);
    }
    f.setRoute((c) => c.name === 'list_code_reviews' ? { data: { codeReviews: [REVIEW], truncated: true } } : defaultGreptileReply(c));
    await expect(command(f, 'status', PR)).rejects.toThrow('truncated');
  });
  it('paginates PRs and comments and neutralizes hostile upstream Markdown', async () => {
    const f = await fixture();
    expect(await command(f, 'prs', 'https://github.com/owner/repo 2')).toContain('Fix bug');
    expect(f.calls.at(-1)!.args).toMatchObject({ offset: 10, limit: 10, state: 'open' });
    f.setRoute((c) => c.name === 'list_merge_request_comments' ? { data: { comments: Array.from({ length: 11 }, (_, i) => ({ body: `<b>${i}</b> [@Bot](#member:evil) ![x](https://evil.test)`, isGreptileComment: true, addressed: false })) } } : defaultGreptileReply(c));
    const first = await command(f, 'comments', PR);
    expect(first).toContain('page 2');
    expect(first).not.toContain('[@Bot]');
    expect(first).not.toContain('<b>');
    const second = await command(f, 'comments', PR + ' 2');
    expect(second).toContain('10');
    expect(second).not.toContain('page 3');
  });
  it.each(['review', 'status', 'comments', 'prs'])('rejects malformed %s arguments before networking', async (name) => {
    const f = await fixture();
    await expect(command(f, name, 'http://localhost/anything')).rejects.toThrow();
    await expect(command(f, name, PR + ' 0 extra')).rejects.toThrow();
    expect(f.initialized).toBe(0);
  });
  it.each(['https://user:pass@github.com/owner/repo/pull/42', 'https://github.com:444/owner/repo/pull/42', 'https://github.com/owner%2frepo/pull/42', 'https://github.com/owner/repo/pull/0', 'https://evil.test/owner/repo/pull/42', 'https://github.com/owner/repo/pull/999999999999999999999', 'https://github.com/owner/../repo/pull/42'])('rejects unsafe target %s', (url) => {
    expect(() => targetUrl(url, true)).toThrow();
  });
  it('parses nested GitLab groups and canonicalizes query and fragment', () => {
    expect(targetUrl('https://gitlab.com/group/sub/project/-/merge_requests/42/?a=b#note', true)).toEqual({ name: 'group/sub/project', remote: 'gitlab', prNumber: 42, url: 'https://gitlab.com/group/sub/project/-/merge_requests/42' });
  });
  it('bounds responses and refuses redirects without forwarding the credential', async () => {
    const f = await fixture(), other = await fixture();
    f.setRoute(() => ({ raw: 'x'.repeat(4096) }));
    await expect(command(f, 'repos', '', { maxBytes: 1024 })).rejects.toThrow('too much data');
    f.setRoute(() => ({ redirect: other.endpoint }));
    await expect(command(f, 'repos', '')).rejects.toThrow();
    expect(other.initialized).toBe(0);
    expect(f.terminated).toBe(2);
  });
});
