// What the space graph finds without a model (spec §8 Space graph,
// 2026-11-12): references by parser, code identifiers by their backticks, and
// candidate topics by word statistics. Pure: text in, candidates out. Jev
// judges the candidates afterwards (questions.ts); nothing here decides what
// a thread is about.

/** `[@Name](#member:id)` reads as `@Name`, images and links as their text: what a person would see. */
export function plainText(body: string): string {
  return body
    .replace(/\[@([^\]]+)\]\(#(?:member:[^)]+|here|rowboat)\)/g, '@$1')
    .replace(/\[#([^\]]+)\]\(#space:[^)]+\)/g, '#$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[image]');
}

/** A clipped string can end in half an emoji; JSON carries it, but Jev's API and strict parsers refuse it. */
export function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

export function excerpt(body: string, max: number): string {
  const flat = plainText(body).replace(/\s+/g, ' ').trim();
  return wellFormed(flat.length > max ? `${flat.slice(0, max - 1)}…` : flat);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- references ------------------------------------------------------------------

const GITHUB_REF = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(pull|issues)\/(\d+)/g;
// "#1234" alone: three to five digits, not part of a word, a path or a mention token's href.
const BARE_REF = /(?<![\w/&#(])#(\d{3,5})\b/g;

/** The repository a space's GitHub links name most: the one a bare "#1234" means there. */
export function mainRepository(bodies: Iterable<string>): string | undefined {
  const count = new Map<string, number>();
  for (const body of bodies) for (const m of body.matchAll(GITHUB_REF)) count.set(`${m[1]}/${m[2]}`, (count.get(`${m[1]}/${m[2]}`) ?? 0) + 1);
  let best: string | undefined;
  for (const [repo, n] of count) if (best === undefined || n > (count.get(best) ?? 0)) best = repo;
  return best;
}

/** `owner/repo#number` for every pull request or issue the text names. */
export function referencesIn(body: string, mainRepo: string | undefined): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(GITHUB_REF)) out.add(`${m[1]}/${m[2]}#${m[4]}`);
  if (mainRepo !== undefined) for (const m of body.replace(/https?:\/\/\S+/g, ' ').matchAll(BARE_REF)) out.add(`${mainRepo}#${m[1]}`);
  return [...out];
}

// --- code identifiers ---------------------------------------------------------------

const CODE_SPAN = /`([^`\n]{3,60})`/g;

/** Backticked identifiers, paths and short commands; fenced blocks are skipped, since they quote output rather than name things. */
export function codeIn(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.replace(/```[\s\S]*?```/g, ' ').matchAll(CODE_SPAN)) {
    const code = (m[1] ?? '').trim().replace(/\(\)$/, '').replace(/^\.\//, '');
    if (code.length >= 3 && code.split(/\s+/).length <= 3 && !code.startsWith('[@')) out.add(code);
  }
  return [...out];
}

// --- candidate topics ---------------------------------------------------------------

const STOP = new Set(
  `a about above after again against all also am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he her here hers herself him himself his how i if in into is isn't it its itself just let me more most my myself no nor not now of off on once one only or other our ours out over own same she should shouldn't so some such than that the their theirs them themselves then there these they this those through to too under until up very was wasn't we were weren't what when where which while who whom why will with won't would wouldn't you your yours yourself yes ok okay please thanks thank need needs want wants make makes made get gets got use uses used using see seen look looks still already yet done new old two three first second next last way thing things lot much many may might must shall like even though however since without within via per etc vs it's i'm i'll i've i'd that's there's what's let's we're you're they're every either neither whether else ever never always often another back going go goes went come comes came say says said know knows knew think thinks thought take takes took give gives gave work works worked working right left good bad sure maybe really actually currently today yesterday tomorrow here's change changes changed add adds added adding remove removes removed fix fixes fixed run runs running ran show shows showed keep keeps kept set sets put try tries tried tell tells told ask asks asked read reads write writes wrote check checks checked open opens opened close closes closed start starts started stop stops stopped twice instead rather able`.split(/\s+/),
);

export interface TopicCandidate {
  /** Lowercased and singular: the candidate's identity. */
  key: string;
  /** The wording seen most. */
  label: string;
  /** Threads it occurs in. */
  threads: number;
  score: number;
}

export interface ThreadText {
  id: string;
  bodies: string[];
}

const MAX_CANDIDATES = 300;

const stem = (word: string): string => (word.length > 4 && /[^s]s$/.test(word) && !/(ss|us|is)$/.test(word) ? word.slice(0, -1) : word);

/**
 * Candidate topics for a space. Two kinds: a single word that is nearly
 * always capitalised mid-sentence (a proper noun), and a pair or triple of
 * words that occur together more than their own frequencies predict
 * (normalised pointwise mutual information). Both must recur across threads
 * without being everywhere. People's names are left out: members are nodes
 * already. A message whose text repeats a template (a scheduled prompt, a
 * standup form) counts once across the space, or its wording outranks real
 * subjects. Thresholds are from the 2026-11-12 experiment on one space.
 */
export function topicCandidates(threads: readonly ThreadText[], memberNames: Iterable<string>): TopicCandidate[] {
  const nameTokens = new Set<string>();
  for (const name of memberNames) for (const token of name.toLowerCase().split(/[^a-z0-9]+/)) if (token.length > 2) nameTokens.add(token);
  interface Stat { n: number; threads: Set<string>; surface: Map<string, number>; mid: number; capital: number }
  const words = new Map<string, Stat>();
  const phrases = new Map<string, Stat>();
  let total = 0;
  const bump = (map: Map<string, Stat>, key: string, thread: string, surface: string, mid = 0, capital = 0): void => {
    let s = map.get(key);
    if (!s) map.set(key, (s = { n: 0, threads: new Set(), surface: new Map(), mid: 0, capital: 0 }));
    s.n++;
    s.threads.add(thread);
    s.surface.set(surface, (s.surface.get(surface) ?? 0) + 1);
    s.mid += mid;
    s.capital += capital;
  };
  const seenBodies = new Set<string>();
  for (const thread of threads) {
    for (const body of thread.bodies) {
      const template = body.replace(/\d+/g, '0').slice(0, 400);
      if (seenBodies.has(template)) continue;
      seenBodies.add(template);
      const clean = plainText(body)
        .replace(/```[\s\S]*?```/g, ' . ')
        .replace(/`[^`\n]*`/g, ' . ')
        .replace(/https?:\/\/\S+/g, ' . ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_>#|~]/g, ' ');
      for (const sentence of clean.split(/[.!?:;\n()[\]"“”]+/)) {
        const tokens = [...sentence.matchAll(/[A-Za-z][A-Za-z0-9'’-]*/g)].map((m) => m[0].replace(/['’]s$/, '')).filter(Boolean);
        const low = tokens.map((t) => stem(t.toLowerCase().replace(/’/g, "'")));
        total += tokens.length;
        for (let i = 0; i < tokens.length; i++) {
          const word = low[i] ?? '';
          if (!STOP.has(word) && word.length > 2) bump(words, word, thread.id, tokens[i] ?? '', i > 0 ? 1 : 0, i > 0 && /^[A-Z]/.test(tokens[i] ?? '') ? 1 : 0);
          for (const n of [2, 3]) {
            if (i + n > tokens.length) continue;
            const first = low[i] ?? '';
            const final = low[i + n - 1] ?? '';
            if (STOP.has(first) || STOP.has(final) || first.length < 3 || final.length < 3) continue;
            bump(phrases, low.slice(i, i + n).join(' '), thread.id, tokens.slice(i, i + n).join(' '));
          }
        }
      }
    }
  }
  const count = threads.length;
  // Recurring, but not everywhere. Small spaces get a floor, or nothing would qualify.
  const least = count >= 200 ? 4 : 2;
  const most = Math.max(count * 0.25, 5);
  const label = (s: Stat): string => [...s.surface.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const found: TopicCandidate[] = [];
  for (const [key, s] of words) {
    const df = s.threads.size;
    if (df < least || df > most || nameTokens.has(key)) continue;
    if (s.mid < least || s.capital / s.mid < 0.6) continue;
    found.push({ key, label: label(s), threads: df, score: df * Math.log(count / df + 1) });
  }
  for (const [key, s] of phrases) {
    const df = s.threads.size;
    if (df < least + (count >= 200 ? 1 : 0) || df > most) continue;
    const parts = key.split(' ');
    if (parts.some((p) => nameTokens.has(p))) continue;
    const content = parts.filter((p) => !STOP.has(p));
    const joint = s.n / total;
    const apart = content.reduce((p, w) => p * ((words.get(w)?.n ?? s.n) / total), 1);
    const npmi = Math.log(joint / apart) / -Math.log(joint) / Math.max(1, content.length - 1);
    if (npmi < 0.25) continue;
    found.push({ key, label: label(s), threads: df, score: df * Math.log(count / df + 1) * npmi });
  }
  found.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  // A pair that only ever appears inside an equally common triple is that triple's fragment.
  const kept = found.filter((c) => !found.some((o) => o !== c && o.key.length > c.key.length && o.key.includes(c.key) && o.threads >= c.threads * 0.8));
  return kept.slice(0, MAX_CANDIDATES);
}

/** Matches any of a topic's wordings as whole words, plural or not. */
export function topicPattern(labels: readonly string[]): RegExp {
  return new RegExp(`(?<![A-Za-z0-9])(?:${labels.map(escapeRe).join('|')})s?(?![A-Za-z0-9])`, 'gi');
}

/** Up to `max` short excerpts around a wording, one per thread: what Jev reads to judge a candidate. */
export function excerptsOf(labels: readonly string[], threads: readonly ThreadText[], max: number): string[] {
  const pattern = topicPattern(labels);
  const out: string[] = [];
  for (const thread of threads) {
    for (const body of thread.bodies) {
      pattern.lastIndex = 0;
      const hit = pattern.exec(body);
      if (!hit) continue;
      out.push(wellFormed(plainText(body.slice(Math.max(0, hit.index - 110), hit.index + hit[0].length + 110)).replace(/\s+/g, ' ')));
      break;
    }
    if (out.length >= max) break;
  }
  return out;
}
