import { crc32 } from 'node:zlib';
import { fromBuffer, type ZipFile, type Entry } from 'yauzl';

/** Internal preview contract: source identities are never Harbor members (2026-11-12). */
export interface SlackIdentity { id: string; name: string; kind: 'person' | 'bot' | 'unknown'; deleted: boolean }
export interface SlackReaction { name: string; count: number; users: string[] }
export interface SlackMessage {
  id: string; timestamp: string; authorId: string; text: string;
  /** Slack mrkdwn, not yet safe/render-ready Markdown. */
  textFormat: 'slack'; parentId?: string; editedAt?: string; deleted: boolean;
  files: { id?: string; name: string; url?: string }[]; reactions: SlackReaction[];
}
export interface SlackChannel {
  id: string; name: string; private: boolean; archived: boolean; topic: string; purpose: string;
  memberIds: string[]; messages: SlackMessage[];
  preview: { messages: number; replies: number; authors: number; firstTimestamp?: string; lastTimestamp?: string };
}
export interface SlackWarning { code: string; path: string; record?: number; detail: string }
export interface SlackPreview {
  channels: SlackChannel[]; identities: SlackIdentity[]; warnings: SlackWarning[];
  records: { read: number; accepted: number; skipped: number; superseded: number };
}
export interface SlackLimits { zipBytes: number; entries: number; expandedBytes: number; entryBytes: number; records: number; warnings: number }
// Conservative parser limits, not subscription entitlements. Reject rather than truncate.
export const SLACK_PREVIEW_LIMITS: Readonly<SlackLimits> = Object.freeze({
  zipBytes: 25 * 1024 * 1024, entries: 10_000, expandedBytes: 100 * 1024 * 1024,
  entryBytes: 10 * 1024 * 1024, records: 100_000, warnings: 10_000,
});
export class SlackExportError extends Error {
  constructor(public readonly code: 'invalid_zip' | 'unsafe_archive' | 'limit_exceeded' | 'invalid_export', message: string) { super(message); this.name = 'SlackExportError'; }
}
function fail(code: SlackExportError['code'], message: string): never { throw new SlackExportError(code, message); }

/** Stream each entry with byte limits; never extract paths or fetch embedded URLs. */
async function readArchive(bytes: Buffer, limits: SlackLimits): Promise<Map<string, Buffer>> {
  if (bytes.length > limits.zipBytes) fail('limit_exceeded', 'ZIP exceeds the upload limit.');
  return new Promise((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new SlackExportError('invalid_zip', 'Cannot read ZIP archive.')); return; }
      const files = new Map<string, Buffer>(); const names = new Set<string>();
      let expanded = 0; let declared = 0; let count = 0; let settled = false;
      const stop = (e: unknown) => { if (settled) return; settled = true; zip.close(); reject(e instanceof SlackExportError ? e : new SlackExportError('invalid_zip', 'Corrupt or unsupported ZIP entry.')); };
      zip.on('error', stop);
      zip.on('end', () => { if (!settled) { settled = true; resolve(files); } });
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          const path = entry.fileName;
          if (++count > limits.entries) fail('limit_exceeded', 'Too many ZIP entries.');
          if (path.startsWith('/') || path.includes('\\') || path.includes('\0') || /^[a-z]:/i.test(path) || path.split('/').some(p => p === '..' || p === '.')) fail('unsafe_archive', 'Unsafe archive path.');
          if (names.has(path)) fail('unsafe_archive', 'Duplicate archive path.');
          names.add(path);
          if ((entry.generalPurposeBitFlag & 1) !== 0 || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) fail('unsafe_archive', 'Encrypted entries and symbolic links are unsupported.');
          declared += entry.uncompressedSize;
          if (entry.uncompressedSize > limits.entryBytes || declared > limits.expandedBytes) fail('limit_exceeded', 'Expanded archive exceeds limits.');
          if (path.endsWith('/')) { zip.readEntry(); return; }
          const stream = await openStream(zip, entry);
          const chunks: Buffer[] = []; let size = 0; let checksum = 0;
          for await (const chunk of stream) {
            size += chunk.length; expanded += chunk.length;
            if (size > limits.entryBytes || expanded > limits.expandedBytes) { stream.destroy(); fail('limit_exceeded', 'Expanded archive exceeds limits.'); }
            checksum = crc32(chunk, checksum);
            chunks.push(Buffer.from(chunk));
          }
          if (checksum !== entry.crc32) fail('invalid_zip', 'ZIP entry checksum mismatch.');
          files.set(path, Buffer.concat(chunks));
          if (!settled) zip.readEntry();
        })().catch(stop);
      });
      zip.readEntry();
    });
  });
}
function openStream(zip: ZipFile, entry: Entry): Promise<import('node:stream').Readable> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error || !stream ? reject(error) : resolve(stream)));
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const str = (v: unknown): string => typeof v === 'string' ? v : '';
const strings = (v: unknown): string[] => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : [];
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{1,12}\.\d{6}$/.test(v);
const compareTs = (a: string, b: string) => { const x = BigInt(a.replace('.', '')); const y = BigInt(b.replace('.', '')); return x < y ? -1 : x > y ? 1 : 0; };
function safeUrl(v: unknown): string | undefined {
  if (typeof v !== 'string') return;
  try { const url = new URL(v); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href; } catch { /* Invalid source URL remains unavailable. */ }
}

/** Parse a standard JSON Slack ZIP into a bounded, read-only preview. No database calls. */
export async function previewSlackExport(bytes: Buffer, overrides: Partial<SlackLimits> = {}): Promise<SlackPreview> {
  const limits = { ...SLACK_PREVIEW_LIMITS, ...overrides };
  if (Object.values(limits).some(v => !Number.isSafeInteger(v) || v <= 0)) throw new RangeError('Limits must be positive safe integers.');
  const files = await readArchive(bytes, limits);
  const result: SlackPreview = { channels: [], identities: [], warnings: [], records: { read: 0, accepted: 0, skipped: 0, superseded: 0 } };
  const warn = (code: string, path: string, detail: string, record?: number) => {
    if (result.warnings.length >= limits.warnings) fail('limit_exceeded', 'Too many import warnings.');
    result.warnings.push({ code, path, detail, ...(record !== undefined ? { record } : {}) });
  };
  let parsedRecords = 0;
  const json = (path: string): unknown[] => {
    const data = files.get(path); if (!data) return [];
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); } catch { fail('invalid_export', `Invalid JSON or UTF-8 in ${path}.`); }
    if (!Array.isArray(value)) fail('invalid_export', `Expected a JSON array in ${path}.`);
    parsedRecords += value.length;
    if (parsedRecords > limits.records) fail('limit_exceeded', 'Export exceeds the record limit.');
    return value;
  };
  if (!files.has('channels.json') && !files.has('groups.json')) fail('invalid_export', 'Expected channels.json or groups.json at the ZIP root. TXT and multi-workspace layouts are unsupported.');
  const userPath = files.has('users.json') ? 'users.json' : 'org_users.json';
  const identities = new Map<string, SlackIdentity>();
  for (const raw of json(userPath)) {
    const u = obj(raw); const id = str(u.id);
    if (!id) { warn('invalid_identity', userPath, 'User without an ID was skipped.'); continue; }
    if (identities.has(id)) fail('invalid_export', `Duplicate user ID in ${userPath}.`);
    const p = obj(u.profile);
    identities.set(id, { id, name: str(p.display_name) || str(p.real_name) || str(u.real_name) || str(u.name) || id, kind: u.is_bot === true ? 'bot' : 'person', deleted: u.deleted === true });
  }
  const useIdentity = (id: string, path: string, bot = false, name = '') => {
    const existing = identities.get(id);
    if (!existing) {
      identities.set(id, { id, name: name || id, kind: bot ? 'bot' : 'unknown', deleted: false });
      if (!bot) warn('unknown_author', path, `No user record for ${id}.`);
    } else if (bot && existing.kind === 'unknown') {
      existing.kind = 'bot'; existing.name = name || existing.name;
    } else if (bot && existing.name === id && name) existing.name = name;
  };
  const consumed = new Set(['channels.json', 'groups.json', userPath]);
  const channelIds = new Set<string>(); const channelNames = new Set<string>();
  const claimedFolders = new Set<string>();
  for (const metaPath of ['channels.json', 'groups.json']) {
    for (const rawChannel of json(metaPath)) {
      const c = obj(rawChannel); const id = str(c.id); const name = str(c.name);
      if (!id || !name || /[\/\\]/.test(name) || name === '.' || name === '..') fail('invalid_export', `Invalid channel ID or name in ${metaPath}.`);
      if (channelIds.has(id) || channelNames.has(name)) fail('invalid_export', 'Ambiguous duplicate channel ID or folder name.');
      channelIds.add(id); channelNames.add(name);
      const channel: SlackChannel = { id, name, private: metaPath === 'groups.json' || c.is_private === true, archived: c.is_archived === true,
        topic: str(obj(c.topic).value), purpose: str(obj(c.purpose).value), memberIds: strings(c.members), messages: [],
        preview: { messages: 0, replies: 0, authors: 0 } };
      for (const member of channel.memberIds) useIdentity(member, metaPath);
      const records = new Map<string, { message: SlackMessage; version: string }>();
      // Slack exports may use channel names or conversation IDs as folder names (2026-11-13).
      const folders = [...new Set([name, id])];
      const candidates = folders.map(folder => ({ folder, paths: [...files.keys()].filter(path => path.startsWith(`${folder}/`) && /^[^/]+\/\d{4}-\d{2}-\d{2}\.json$/.test(path)).sort() })).filter(candidate => candidate.paths.length);
      if (candidates.length > 1) fail('invalid_export', `Ambiguous history folders for channel ${id}.`);
      const candidate = candidates[0];
      if (candidate && claimedFolders.has(candidate.folder)) fail('invalid_export', 'A history folder belongs to multiple channels.');
      if (candidate) claimedFolders.add(candidate.folder);
      const paths = candidate?.paths ?? [];
      for (const path of paths) {
        consumed.add(path);
        const rows = json(path);
        for (let index = 0; index < rows.length; index++) {
          result.records.read++;
          const outer = obj(rows[index]); const subtype = str(outer.subtype);
          const row = subtype === 'message_changed' && outer.message ? obj(outer.message) : outer;
          const deleted = subtype === 'message_deleted';
          if (subtype === 'message_changed' && !outer.message && !timestamp(outer.original_ts)) fail('invalid_export', `Edit without an original message timestamp in ${path}.`);
          const ts = deleted ? outer.deleted_ts ?? outer.original_ts ?? obj(outer.previous_message).ts : subtype === 'message_changed' ? outer.original_ts ?? row.ts : row.ts;
          if (outer.type !== 'message' || !timestamp(ts)) { result.records.skipped++; warn('invalid_message', path, 'Missing message type or valid timestamp.', index); continue; }
          const supported = ['', 'bot_message', 'me_message', 'file_share', 'thread_broadcast', 'message_changed', 'message_deleted'];
          if (!supported.includes(subtype)) { result.records.skipped++; warn('unsupported_subtype', path, `Skipped message subtype: ${subtype}.`, index); continue; }
          if (subtype === 'message_changed' && (typeof row.text !== 'string' || row.text.length > 65_536)) fail('invalid_export', `Unusable edit in ${path}; refusing to restore an older message version.`);
          if (!deleted && typeof row.text !== 'string') { result.records.skipped++; warn('missing_text', path, 'No text fallback; record was skipped.', index); continue; }
          const text = deleted ? '' : str(row.text);
          if (text.length > 65_536) { result.records.skipped++; warn('oversized_message', path, 'Message exceeds Rowboat’s text limit; not truncated.', index); continue; }
          const previousSource = obj(outer.previous_message ?? outer.previous);
          const authorId = (deleted ? str(previousSource.user) || str(row.user) : str(row.user)) || (str(row.bot_id) ? `bot:${str(row.bot_id)}` : `unknown:${id}:${ts}`);
          useIdentity(authorId, path, !!row.bot_id || subtype === 'bot_message', str(row.username) || str(obj(row.bot_profile).name));
          let parentId: string | undefined;
          const threadTs = row.thread_ts ?? (deleted ? previousSource.thread_ts : undefined);
          if (threadTs !== undefined && !timestamp(threadTs)) warn('invalid_parent', path, 'Invalid thread timestamp; treated as a root.', index);
          else if (timestamp(threadTs) && threadTs !== ts) parentId = threadTs;
          const reactions: SlackReaction[] = [];
          for (const raw of deleted ? [] : Array.isArray(row.reactions) ? row.reactions : []) {
            const reaction = obj(raw); const users = strings(reaction.users);
            if (!str(reaction.name) || !Number.isSafeInteger(reaction.count) || Number(reaction.count) < users.length) { warn('invalid_reaction', path, 'Invalid reaction was skipped.', index); continue; }
            users.forEach(user => useIdentity(user, path));
            reactions.push({ name: str(reaction.name), count: Number(reaction.count), users });
          }
          const attachments: SlackMessage['files'] = [];
          for (const raw of deleted ? [] : Array.isArray(row.files) ? row.files : []) {
            const f = obj(raw); const url = safeUrl(f.permalink);
            attachments.push({ ...(str(f.id) ? { id: str(f.id) } : {}), name: str(f.name) || str(f.title) || 'Unavailable file', ...(url ? { url } : {}) });
            if (!url) warn('unavailable_file', path, 'File has no usable permalink.', index);
          }
          if (!deleted && (row.blocks || row.attachments)) warn('rich_content_fallback', path, 'Preview preserves text fallback; rich blocks/attachments are not converted.', index);
          const editedAt = timestamp(obj(row.edited).ts) ? obj(row.edited).ts as string : subtype === 'message_changed' && timestamp(outer.ts) ? outer.ts : undefined;
          const version = deleted && timestamp(outer.ts) ? outer.ts : editedAt ?? ts;
          const message: SlackMessage = { id: ts, timestamp: ts, authorId, text, textFormat: 'slack', deleted, files: attachments, reactions,
            ...(parentId ? { parentId } : {}), ...(editedAt ? { editedAt } : {}) };
          const previous = records.get(ts);
          if (previous) {
            result.records.superseded++;
            if (previous.message.deleted) {
              // A deletion may precede its original in the archive. Recover attribution, never text.
              if (previous.message.authorId.startsWith('unknown:') && !authorId.startsWith('unknown:')) previous.message.authorId = authorId;
              if (!previous.message.parentId && parentId) previous.message.parentId = parentId;
              continue;
            }
            if (!deleted && compareTs(version, previous.version) < 0) continue;
            if (deleted) { message.authorId = previous.message.authorId; message.parentId ??= previous.message.parentId; }
            warn('duplicate_or_revision', path, 'Multiple records resolve to one message.', index);
          }
          records.set(ts, { message, version });
        }
      }
      channel.messages = [...records.values()].map(r => r.message).sort((a, b) => compareTs(a.timestamp, b.timestamp));
      for (const message of channel.messages) {
        if (!message.parentId) continue;
        const parent = records.get(message.parentId)?.message;
        if (!parent) warn('missing_parent', name, `Reply ${message.id} references unavailable parent ${message.parentId}; preserve a placeholder on import.`);
        else if (parent.parentId) fail('invalid_export', `Thread parent ${parent.id} is itself a reply in channel ${id}.`);
      }
      channel.preview = { messages: channel.messages.length, replies: channel.messages.filter(m => m.parentId).length,
        authors: new Set(channel.messages.map(m => m.authorId)).size,
        ...(channel.messages.length ? { firstTimestamp: channel.messages[0]!.timestamp, lastTimestamp: channel.messages.at(-1)!.timestamp } : {}) };
      result.records.accepted += channel.messages.length;
      result.channels.push(channel);
    }
  }
  for (const path of files.keys()) if (!consumed.has(path)) warn('unsupported_file', path, 'Not included in channel preview (DMs, ancillary data and other layouts are unsupported).');
  const referenced = new Set(result.channels.flatMap(c => [
    ...c.memberIds, ...c.messages.flatMap(m => [m.authorId, ...m.reactions.flatMap(r => r.users)]),
  ]));
  result.identities = [...referenced].map(id => identities.get(id)!);
  return result;
}
