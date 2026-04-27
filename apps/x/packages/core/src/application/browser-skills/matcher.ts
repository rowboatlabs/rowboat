import type { SkillEntry, SkillsIndex } from './loader.js';

/**
 * Map browser-harness `domain-skills/<site>/` folder names to hostname tokens we
 * match against the current tab's URL.
 *
 * Heuristic: for each site folder we generate candidate hostnames like
 *   "booking-com" -> ["booking-com", "bookingcom", "booking.com"]
 *   "github"      -> ["github", "github.com"]
 *   "dev-to"      -> ["dev-to", "devto", "dev.to"]
 * Then we check whether any candidate is a substring of the tab hostname.
 */
function siteCandidates(site: string): string[] {
  const candidates = new Set<string>();
  candidates.add(site);
  candidates.add(site.replace(/-/g, ''));
  candidates.add(site.replace(/-/g, '.'));
  if (site.endsWith('-com')) {
    candidates.add(`${site.slice(0, -4)}.com`);
  }
  if (site.endsWith('-org')) {
    candidates.add(`${site.slice(0, -4)}.org`);
  }
  if (site.endsWith('-io')) {
    candidates.add(`${site.slice(0, -3)}.io`);
  }
  return Array.from(candidates);
}

function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function matchSkillsForUrl(index: SkillsIndex, url: string, limit = 5): SkillEntry[] {
  const hostname = extractHostname(url);
  if (!hostname) return [];

  const bySite = new Map<string, SkillEntry[]>();
  for (const entry of index.entries) {
    if (!bySite.has(entry.site)) bySite.set(entry.site, []);
    bySite.get(entry.site)!.push(entry);
  }

  const matched: SkillEntry[] = [];
  for (const [site, entries] of bySite) {
    const candidates = siteCandidates(site);
    const hit = candidates.some((c) => hostname === c || hostname.endsWith(`.${c}`) || hostname.includes(c));
    if (hit) matched.push(...entries);
  }

  return matched.slice(0, limit);
}
