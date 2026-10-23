import { z } from 'zod';
import { integrationPlatform, UsageError, type Command, type Integration } from '../commands.js';
import {
  GreptileApi, GreptileError, catalogSchema, commentsSchema, prsSchema, reviewDetailSchema, reviewsSchema,
  type GreptileOptions, type GreptileSession, type Repository,
} from './client.js';

const PAGE_SIZE = 10;
export interface Target { name: string; remote: 'github' | 'gitlab'; url: string; prNumber?: number }

export function targetUrl(raw: string, pr: boolean): Target {
  // The composer serializes pasted URLs as Markdown autolinks (2026-10-23, manual Greptile QA).
  if (raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1);
  if (raw.length > 2048) throw new UsageError('The URL is too long.');
  let url: URL;
  try { url = new URL(raw); } catch { throw new UsageError('Use a full HTTPS GitHub or GitLab URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || /:\d+$/.test(raw.split('/')[2] ?? '') || !['github.com', 'gitlab.com'].includes(url.hostname)
    || /%|\\/.test(raw.split(/[?#]/)[0]!) || /\/\.{1,2}(?:\/|$)/.test(raw)) {
    throw new UsageError('Use a cloud GitHub or GitLab HTTPS URL without credentials or encoded paths.');
  }
  const path = url.pathname.replace(/\/$/, '');
  const remote = url.hostname === 'github.com' ? 'github' : 'gitlab';
  const match = pr
    ? (remote === 'github' ? /^\/([^/]+\/[^/]+)\/pull\/([1-9]\d*)$/ : /^\/(.+)\/-\/merge_requests\/([1-9]\d*)$/).exec(path)
    : (remote === 'github' ? /^\/([^/]+\/[^/]+)$/ : /^\/(.+\/[^/]+)$/).exec(path);
  if (!match || !match[1]!.split('/').every((s) => /^[\w.-]+$/.test(s) && s !== '.' && s !== '..' && s !== '-')) {
    throw new UsageError(pr ? 'Use a pull request or merge request URL.' : 'Use a repository URL.');
  }
  const prNumber = pr ? Number(match[2]) : undefined;
  if (prNumber !== undefined && !Number.isSafeInteger(prNumber)) throw new UsageError('The pull request number is too large.');
  return { name: match[1]!, remote, url: `https://${url.hostname}${path}`, ...(prNumber === undefined ? {} : { prNumber }) };
}

function pageNumber(value?: string): number {
  if (value === undefined) return 1;
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 100) throw new UsageError('Use a page number from 1 to 100.');
  return Number(value);
}
function words(args: string, min: number, max: number): string[] {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length < min || parts.length > max) throw new UsageError('Check the command arguments.');
  return parts;
}

// Upstream text must not create a Spaces mention or active Markdown (spec §8 Greptile, 2026-10-22).
export function displayText(value: string | null | undefined, limit = 800): string {
  const text = (value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (text.slice(0, limit) + (text.length > limit ? '…' : '')).replace(/([\\`*_{}\[\]()<>#+.!|~-])/g, '\\$1').replace(/@/g, '＠');
}
function repositoryUrl(repo: Pick<Repository, 'name' | 'remote'>): string {
  return `https://${repo.remote === 'github' ? 'github.com' : 'gitlab.com'}/${repo.name.split('/').map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)).join('/')}`;
}
function identity(repo: Repository): Record<string, unknown> {
  return { name: repo.name, remote: repo.remote, defaultBranch: repo.defaultBranch };
}
async function resolve(session: GreptileSession, target: Target): Promise<Repository> {
  const matches: Repository[] = [];
  for (let page = 0; page < 10; page++) {
    const result = await session.call('list_repositories', { nameContains: target.name, page, limit: 100 }, catalogSchema);
    matches.push(...result.repositories.filter((repo) => repo.name === target.name && repo.remote === target.remote && !repo.remoteUrl));
    if (result.repositories.length < 100 || (page + 1) * 100 >= result.total) {
      if (matches.length === 1) return matches[0]!;
      throw new GreptileError(matches.length ? 'This repository is ambiguous in Greptile.' : 'This repository is not available to this Greptile key. Connect it in Greptile first.');
    }
  }
  throw new GreptileError('The repository lookup exceeded its limit. Narrow the repository catalog in Greptile.');
}
function more(page: number, hasMore: boolean): string {
  return hasMore ? (page < 100 ? `\nMore results may be available. Repeat this command with page ${page + 1}.` : '\nPage limit reached. View additional results in Greptile.') : '';
}

const commands: Command<GreptileApi>[] = [
  {
    name: 'repos', args: '[page]', summary: 'list repositories connected to Greptile',
    async run(api, args) {
      const page = pageNumber(words(args, 0, 1)[0]);
      return api.withSession(async (s) => {
        const result = await s.call('list_repositories', { page: page - 1, limit: PAGE_SIZE }, catalogSchema);
        if (!result.repositories.length) return 'No repositories on this page. Connect repositories in Greptile if the catalog is empty.';
        return result.repositories.map((r) => {
          const cloud = ['github', 'gitlab'].includes(r.remote) && !r.remoteUrl;
          const name = cloud ? `[${displayText(r.name)}](${repositoryUrl(r)})` : displayText(r.name);
          return `- ${name} · ${displayText(r.remote)} · ${r.reviewsEnabled ? 'reviews enabled' : 'reviews disabled'}${cloud ? '' : ' · unsupported provider or instance'}`;
        }).join('\n') + more(page, result.total > page * PAGE_SIZE);
      });
    },
  },
  {
    name: 'prs', args: '<repository-url> [page]', summary: 'list open pull requests or merge requests',
    async run(api, args) {
      const parts = words(args, 1, 2), target = targetUrl(parts[0]!, false), page = pageNumber(parts[1]);
      return api.withSession(async (s) => {
        const repo = await resolve(s, target);
        const result = await s.call('list_pull_requests', { ...identity(repo), state: 'open', limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, prsSchema);
        if (!result.mergeRequests.length) return 'No open pull requests on this page.';
        return result.mergeRequests.map((p) => `- [#${p.number}](${target.url}/${target.remote === 'github' ? 'pull' : '-/merge_requests'}/${p.number}) ${displayText(p.title, 240)} · ${displayText(p.authorLogin)}`).join('\n') + more(page, result.mergeRequests.length === PAGE_SIZE);
      });
    },
  },
  {
    name: 'review', args: '<pr-url>', summary: 'request a review; may consume your Greptile review allowance',
    async run(api, args) {
      const target = targetUrl(words(args, 1, 1)[0]!, true);
      return api.withSession(async (s) => {
        const repo = await resolve(s, target);
        if (!repo.reviewsEnabled) throw new GreptileError('Reviews are disabled for this repository. Enable them in Greptile first.');
        await s.call('trigger_code_review', { ...identity(repo), prNumber: target.prNumber }, z.object({ success: z.literal(true) }));
        return `Review requested for [${target.name} #${target.prNumber}](${target.url}).\n\n**Queued** — the review has not finished yet.\n\nTo check progress, select me from the @ mention picker, then paste this command:\n\n\`\`\`text\nstatus ${target.url}\n\`\`\``;
      });
    },
  },
  {
    name: 'status', args: '<pr-url>', summary: 'read the latest visible review and summary',
    async run(api, args) {
      const target = targetUrl(words(args, 1, 1)[0]!, true);
      return api.withSession(async (s) => {
        const repo = await resolve(s, target);
        const reviews = [];
        for (let offset = 0; offset <= 1000; offset += 100) {
          const result = await s.call('list_code_reviews', { ...identity(repo), prNumber: target.prNumber, limit: 100, offset }, reviewsSchema);
          if (result.truncated) throw new GreptileError('Greptile truncated the review list. View the latest run in Greptile.');
          reviews.push(...result.codeReviews);
          if (result.codeReviews.length < 100) break;
          if (offset === 1000) throw new GreptileError('Too many reviews to determine the latest run. View it in Greptile.');
        }
        const review = reviews.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
        if (!review) return 'No review visible yet. Check status again shortly if you just requested one.';
        const states: Record<string, string> = { PENDING: 'Queued', REVIEWING_FILES: 'Reviewing files', GENERATING_SUMMARY: 'Generating summary', COMPLETED: 'Completed', FAILED: 'Failed', SKIPPED: 'Skipped' };
        let body = `${target.url}\n\n${states[review.status] ?? `Status: ${displayText(review.status)}`} · review ${displayText(review.id)} · ${displayText(review.createdAt)}${review.commitSha ? ` · commit ${displayText(review.commitSha)}` : ''}`;
        if (review.status === 'COMPLETED') {
          const detail = await s.call('get_code_review', { codeReviewId: review.id }, reviewDetailSchema);
          if (detail.codeReview.id !== review.id) throw new GreptileError('Greptile returned a different review than requested.');
          if (detail.codeReview.body) body += `\n\n${displayText(detail.codeReview.body, 4000)}`;
        }
        return body;
      });
    },
  },
  {
    name: 'comments', args: '<pr-url> [page]', summary: 'read unaddressed Greptile comments on the PR',
    async run(api, args) {
      const parts = words(args, 1, 2), target = targetUrl(parts[0]!, true), page = pageNumber(parts[1]);
      return api.withSession(async (s) => {
        const repo = await resolve(s, target);
        const result = await s.call('list_merge_request_comments', { ...identity(repo), prNumber: target.prNumber, greptileGenerated: true, addressed: false }, commentsSchema);
        const comments = result.comments.filter((c) => c.isGreptileComment && !c.addressed);
        const shown = comments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        if (!shown.length) return 'No unaddressed Greptile comments on this page.';
        return `${target.url}\n\nPR findings (not necessarily from the latest run):\n` + shown.map((c) => `- ${displayText(c.filePath ?? 'Overview', 200)}${c.lineStart ? `:${c.lineStart}` : ''}: ${displayText(c.body, 700)}`).join('\n') + more(page, comments.length > page * PAGE_SIZE);
      });
    },
  },
];

export function greptileIntegration(options: GreptileOptions = {}): Integration<GreptileApi> {
  return {
    label: 'Greptile',
    client: (secret) => new GreptileApi(secret, options),
    check: (api) => api.check(),
    commands: commands.map((command) => ({
      ...command,
      async run(api, args) {
        const body = await command.run(api, args);
        return body.length <= 12_000 ? body : body.slice(0, 11_800) + '\n\nOutput shortened. View the full results in Greptile.';
      },
    })),
  };
}
export function greptilePlatform(options: GreptileOptions = {}) {
  return integrationPlatform(greptileIntegration(options));
}
