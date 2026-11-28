import type { Json } from '../jev.js';
import { wellFormed } from '../graph/text.js';

// Reading a trigger's payload without knowing its app (spec §8 Space
// connections, 2026-11-28). Every Composio trigger has its own payload shape,
// and a space may connect any of them, so nothing here names an app: a title,
// a link and a subject are found by the field names services commonly use.
// These are heuristics, tested on the shapes Linear and GitHub send; a payload
// they find nothing in still posts, without a title of its own or a thread to
// join.

const TITLE_KEYS = ['title', 'name', 'subject', 'summary', 'headline'];
const TEXT_KEYS = ['text', 'message', 'body', 'description', 'content'];
const URL_KEYS = ['url', 'html_url', 'htmlUrl', 'web_url', 'webUrl', 'permalink', 'link', 'href'];
/** How deep a field is looked for: an event's own fields, the object it is about, and that object's parent. */
const MAX_DEPTH = 3;
export const TITLE_MAX = 140;

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Breadth-first, so an event's own field wins over one nested in the thing it is about. */
function find(data: unknown, keys: readonly string[], accept: (value: string) => boolean): string | undefined {
  let level: Fields[] = isObject(data) ? [data] : [];
  for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth++) {
    for (const key of keys) {
      for (const fields of level) {
        const value = fields[key];
        if (typeof value === 'string' && accept(value.trim())) return value.trim();
      }
    }
    level = level.flatMap((fields) => Object.values(fields).filter(isObject));
  }
  return undefined;
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return wellFormed(flat.length > max ? `${flat.slice(0, max - 1)}…` : flat);
};

const isHttpUrl = (value: string): boolean => {
  if (!/^https?:\/\//i.test(value) || value.length > 2000) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

/** What the event is about, in a line: its title or name, else the start of its text. */
export function titleOf(data: unknown): string | undefined {
  const title = find(data, TITLE_KEYS, (v) => v.length > 0) ?? find(data, TEXT_KEYS, (v) => v.length > 0);
  return title ? clip(title, TITLE_MAX) : undefined;
}

/** Where the event's object lives in its app. */
export function urlOf(data: unknown): string | undefined {
  return find(data, URL_KEYS, isHttpUrl);
}

/**
 * What ties two events to one thread: the address of the thing they are
 * about. A comment's address is its issue's with a fragment
 * (`…/issue/ENG-1#comment-9`, `…/pull/5#issuecomment-1`), so dropping the
 * fragment and the query puts a comment, an update and the original event on
 * one subject. Undefined when the payload carries no address.
 */
export function subjectOf(data: unknown): string | undefined {
  const url = urlOf(data);
  if (!url) return undefined;
  const parsed = new URL(url);
  return `${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
}

const STRING_MAX = 600;
const ARRAY_MAX = 8;
const KEYS_MAX = 40;

/** Clipped strings, cut lists, and an ellipsis for anything nested at `depthCap` or deeper. */
function shrink(value: unknown, depth: number, depthCap: number): Json {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return clip(value, STRING_MAX);
  if (typeof value !== 'object') return null;
  if (depth >= depthCap) return '…';
  if (Array.isArray(value)) return value.slice(0, ARRAY_MAX).map((v) => shrink(v, depth + 1, depthCap));
  const out: Record<string, Json> = {};
  for (const [key, v] of Object.entries(value as Fields).slice(0, KEYS_MAX)) {
    if (v === undefined || v === null || v === '') continue;
    out[key] = shrink(v, depth + 1, depthCap);
  }
  return out;
}

/**
 * The payload as a model reads it: long strings clipped, long lists cut, and
 * the whole kept under `maxChars` by dropping the deepest detail first. A
 * webhook body can run to hundreds of kilobytes, and neither Jev nor the
 * writer needs more than what a person would read of it.
 */
export function digest(data: unknown, maxChars = 6000): Json {
  let shrunk: Json = null;
  for (let depthCap = 5; depthCap >= 1; depthCap--) {
    shrunk = shrink(data, 0, depthCap);
    if (JSON.stringify(shrunk).length <= maxChars) return shrunk;
  }
  return clampTotal(shrunk, maxChars);
}

/** The last resort for a flat payload of many long fields: keep fields until the budget is spent. */
function clampTotal(value: Json, maxChars: number): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || JSON.stringify(value).length <= maxChars) return value;
  const out: Record<string, Json> = {};
  let used = 2;
  for (const [key, v] of Object.entries(value)) {
    const size = JSON.stringify(v).length + key.length + 4;
    if (used + size > maxChars) continue;
    out[key] = v;
    used += size;
  }
  return out;
}
