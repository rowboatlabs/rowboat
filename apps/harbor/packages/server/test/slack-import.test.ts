import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { previewSlackExport } from '../src/imports/slack.js';

// Small stored ZIP builder keeps adversarial headers under the test's control.
function zip(files: Record<string, unknown>, flags = 0, compress = false): Buffer {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [path, value] of Object.entries(files)) {
    const name = Buffer.from(path); const data = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const payload = compress ? deflateRawSync(data) : data;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(flags, 6); h.writeUInt16LE(compress ? 8 : 0, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(payload.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26);
    local.push(h, name, payload);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(compress ? 8 : 0, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(payload.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name); offset += h.length + name.length + payload.length;
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`./fixtures/slack/${name}.json`, import.meta.url), 'utf8'));
const basic = (rows: unknown[]) => ({ 'channels.json': [{ id: 'C1', name: 'general' }], 'users.json': [{ id: 'U1', name: 'Alex' }], 'general/2026-01-01.json': rows });
const message = (extra = {}) => ({ type: 'message', user: 'U1', ts: '1767225600.000001', text: 'Original', ...extra });

describe('Slack ZIP preview', () => {
  it('normalizes public history, exact order, authors, files and incomplete reactor lists', async () => {
    const result = await previewSlackExport(zip(fixture('public')));
    const c = result.channels[0]!;
    expect(c.preview).toEqual({ messages: 2, replies: 1, authors: 2, firstTimestamp: '1767225600.000001', lastTimestamp: '1767225600.000002' });
    expect(c.messages[1]!.parentId).toBe(c.messages[0]!.id);
    expect(c.messages[0]!.reactions).toEqual([{ name: 'wave', count: 5, users: ['U2'] }]);
    expect(c.messages[0]!.files[0]!.name).toBe('notes.pdf');
    expect(result.identities.map(u => u.id)).toEqual(['U1', 'U2']);
    expect(result.identities[1]!.deleted).toBe(true);
    expect(result.records).toEqual({ read: 2, accepted: 2, skipped: 0, superseded: 0 });
    expect(await previewSlackExport(zip(fixture('public')))).toEqual(result);
  });
  it('recognizes Enterprise users/private channels but excludes DMs and ancillary data', async () => {
    const result = await previewSlackExport(zip(fixture('enterprise')));
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]).toMatchObject({ private: true, archived: true });
    expect(result.identities.find(u => u.id === 'B1')!.kind).toBe('bot');
    expect(result.warnings.map(w => w.code)).toContain('missing_parent');
    expect(result.warnings.filter(w => w.code === 'unsupported_file')).toHaveLength(3);
    expect(JSON.stringify(result.channels)).not.toContain('Do not import this');
  });
  it('resolves edits and duplicate copies to one latest message', async () => {
    const rows = [message(), message({ subtype: 'message_changed', original_ts: '1767225600.000001', ts: '1767225601.000001', text: 'Edited', previous: { text: 'Original' } }), message()];
    const r = await previewSlackExport(zip(basic(rows)));
    expect(r.channels[0]!.messages).toHaveLength(1);
    expect(r.channels[0]!.messages[0]).toMatchObject({ text: 'Edited', editedAt: '1767225601.000001' });
    expect(r.records).toEqual({ read: 3, accepted: 1, skipped: 0, superseded: 2 });
  });
  it('does not resurrect deleted content even when the original comes later', async () => {
    const deletion = { type: 'message', subtype: 'message_deleted', deleted_ts: '1767225600.000001', ts: '1767225602.000001', previous: { text: 'secret' } };
    for (const rows of [[message(), deletion], [deletion, message()]]) {
      const r = await previewSlackExport(zip(basic(rows)));
      expect(r.channels[0]!.messages[0]).toMatchObject({ text: '', deleted: true, authorId: 'U1', files: [], reactions: [] });
      expect(JSON.stringify(r.channels)).not.toContain('secret');
    }
  });
  it('reports malformed/unsupported/oversized messages and leaves unknown identities explicit', async () => {
    const r = await previewSlackExport(zip(basic([{}, message({ ts: 'bad' }), message({ subtype: 'channel_join' }), message({ text: 'a'.repeat(65537) }), message({ user: 'MISSING' })])));
    expect(r.records).toEqual({ read: 5, accepted: 1, skipped: 4, superseded: 0 });
    expect(r.identities.find(u => u.id === 'MISSING')).toMatchObject({ kind: 'unknown' });
    expect(r.warnings.map(w => w.code)).toEqual(expect.arrayContaining(['invalid_message', 'unsupported_subtype', 'oversized_message', 'unknown_author']));
  });
  it('keeps file links inert and rejects unsafe URL schemes', async () => {
    const r = await previewSlackExport(zip(basic([message({ files: [{ name: 'x', permalink: 'javascript:alert(1)' }], blocks: [] })])));
    expect(r.channels[0]!.messages[0]!.files).toEqual([{ name: 'x' }]);
    expect(r.channels[0]!.messages[0]!.textFormat).toBe('slack');
    expect(r.warnings.map(w => w.code)).toContain('unavailable_file');
  });
  it('rejects invalid ZIPs, malformed JSON and unsupported layouts', async () => {
    await expect(previewSlackExport(Buffer.from('no zip'))).rejects.toMatchObject({ code: 'invalid_zip' });
    await expect(previewSlackExport(zip({ 'channels.json': '{bad' }))).rejects.toMatchObject({ code: 'invalid_export' });
    await expect(previewSlackExport(zip({ 'channels.json': {} }))).rejects.toMatchObject({ code: 'invalid_export' });
    await expect(previewSlackExport(zip({ 'general.txt': 'text' }))).rejects.toMatchObject({ code: 'invalid_export' });
  });
  it('rejects traversal, encrypted entries and ambiguous channel folders', async () => {
    await expect(previewSlackExport(zip({ '../channels.json': [] }))).rejects.toBeInstanceOf(Error);
    await expect(previewSlackExport(zip(basic([]), 1))).rejects.toMatchObject({ code: 'invalid_zip' });
    await expect(previewSlackExport(zip({ 'channels.json': [{ id: 'C1', name: 'general' }, { id: 'C2', name: 'general' }] }))).rejects.toMatchObject({ code: 'invalid_export' });
  });
  it('reads deflated exports and rejects false expanded sizes', async () => {
    const bytes = zip(fixture('public'), 0, true);
    expect((await previewSlackExport(bytes)).channels[0]!.preview.messages).toBe(2);
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(1, central + 24);
    await expect(previewSlackExport(bytes)).rejects.toMatchObject({ code: 'invalid_zip' });
  });
  it('rejects bad CRCs, symlinks and duplicate archive entries', async () => {
    const corrupt = zip(basic([]));
    const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    corrupt.writeUInt32LE(0, central + 16);
    await expect(previewSlackExport(corrupt)).rejects.toMatchObject({ code: 'invalid_zip' });
    const symlink = zip(basic([]));
    symlink.writeUInt32LE(0xa0000000, central + 38);
    await expect(previewSlackExport(symlink)).rejects.toMatchObject({ code: 'unsafe_archive' });
    const duplicate = zip({ 'channels.json': [], 'xhannels.json': [] });
    for (let i = 0; i < duplicate.length; i++) if (duplicate.subarray(i, i + 13).toString() === 'xhannels.json') duplicate[i] = 'c'.charCodeAt(0);
    await expect(previewSlackExport(duplicate)).rejects.toMatchObject({ code: 'unsafe_archive' });
  });
  it('supports ID folders and rejects aliases shared by two channels', async () => {
    const files = basic([message()]);
    const byId: Record<string, unknown> = { ...files };
    delete byId['general/2026-01-01.json']; byId['C1/2026-01-01.json'] = [message()];
    expect((await previewSlackExport(zip(byId))).channels[0]!.preview.messages).toBe(1);
    await expect(previewSlackExport(zip({ ...files, 'C1/2026-01-01.json': [message()] }))).rejects.toMatchObject({ code: 'invalid_export' });
    await expect(previewSlackExport(zip({ 'channels.json': [{ id: 'C1', name: 'general' }, { id: 'C2', name: 'C1' }], 'C1/2026-01-01.json': [message()] }))).rejects.toMatchObject({ code: 'invalid_export' });
  });
  it('keeps deletions with earlier or missing deletion timestamps in any order', async () => {
    const edited = message({ edited: { ts: '1767225605.000001' }, text: 'must not survive' });
    for (const deletion of [
      { type: 'message', subtype: 'message_deleted', deleted_ts: edited.ts },
      { type: 'message', subtype: 'message_deleted', deleted_ts: edited.ts, ts: '1767225602.000001' },
    ]) for (const rows of [[edited, deletion], [deletion, edited]]) {
      const r = await previewSlackExport(zip(basic(rows)));
      expect(r.channels[0]!.messages[0]).toMatchObject({ deleted: true, text: '', authorId: 'U1' });
      expect(r.records).toEqual({ read: 2, accepted: 1, superseded: 1, skipped: 0 });
    }
  });
  it('recovers standalone tombstone metadata without retaining deleted text', async () => {
    const r = await previewSlackExport(zip(basic([{ type: 'message', subtype: 'message_deleted', ts: '1767225602.000001',
      previous_message: message({ thread_ts: '1767225500.000001' }) }])));
    expect(r.channels[0]!.messages[0]).toMatchObject({ deleted: true, text: '', authorId: 'U1', parentId: '1767225500.000001' });
    expect(r.warnings.map(w => w.code)).toContain('missing_parent');
  });
  it('preserves bot names and promotes roster placeholders to historical bots', async () => {
    const input = basic([message({ user: 'U_BOT', bot_id: 'B1', subtype: 'bot_message', bot_profile: { name: 'Build bot' } }),
      message({ user: undefined, bot_id: 'B2', subtype: 'bot_message', username: 'Legacy bot', ts: '1767225600.000002' })]);
    const r = await previewSlackExport(zip({ ...input, 'channels.json': [{ id: 'C1', name: 'general', members: ['U_BOT'] }] }));
    expect(r.identities).toEqual(expect.arrayContaining([
      { id: 'U_BOT', name: 'Build bot', kind: 'bot', deleted: false },
      { id: 'bot:B2', name: 'Legacy bot', kind: 'bot', deleted: false },
    ]));
  });
  it('resolves nested edits in either order and accounts for every record', async () => {
    const revision = { type: 'message', subtype: 'message_changed', ts: '1767225605.000001',
      message: message({ text: 'Updated', edited: { user: 'EDITOR', ts: '1767225604.000001' } }) };
    for (const rows of [[message(), revision], [revision, message()]]) {
      const r = await previewSlackExport(zip(basic([...rows, {}, message({ subtype: 'channel_join' })])));
      expect(r.channels[0]!.messages[0]).toMatchObject({ text: 'Updated', authorId: 'U1', editedAt: '1767225604.000001' });
      expect(r.records.read).toBe(r.records.accepted + r.records.skipped + r.records.superseded);
      expect(r.records).toEqual({ read: 4, accepted: 1, skipped: 2, superseded: 1 });
    }
  });
  it('distinguishes missing roots from invalid parent chains or cycles', async () => {
    const root = message(); const reply = message({ ts: '1767225600.000002', thread_ts: root.ts });
    await expect(previewSlackExport(zip(basic([root, reply, message({ ts: '1767225600.000003', thread_ts: reply.ts })])))).rejects.toMatchObject({ code: 'invalid_export' });
    await expect(previewSlackExport(zip(basic([message({ thread_ts: reply.ts }), reply])))).rejects.toMatchObject({ code: 'invalid_export' });
    expect((await previewSlackExport(zip(basic([root, reply])))).warnings).toEqual([]);
  });
  it('reports unsupported Enterprise layouts without claiming complete coverage', async () => {
    await expect(previewSlackExport(zip({ 'T1/channels.json': [], 'T1/org_users.json': [] }))).rejects.toMatchObject({ code: 'invalid_export' });
    const r = await previewSlackExport(zip({ ...basic([]), 'T1/channels.json': [], 'T1/general/2026-01-01.json': [message()] }));
    expect(r.records.read).toBe(0);
    expect(r.warnings.filter(w => w.code === 'unsupported_file')).toHaveLength(2);
  });
  it('rejects unusable edit records instead of showing stale original text', async () => {
    for (const edit of [
      message({ subtype: 'message_changed', original_ts: message().ts, text: undefined }),
      message({ subtype: 'message_changed', original_ts: message().ts, text: 'x'.repeat(65537) }),
      message({ subtype: 'message_changed', ts: '1767225602.000001' }),
    ]) await expect(previewSlackExport(zip(basic([message(), edit])))).rejects.toMatchObject({ code: 'invalid_export' });
  });
  it.each([
    { zipBytes: 1 }, { entries: 1 }, { entryBytes: 1 }, { expandedBytes: 1 }, { records: 1 }, { warnings: 1 },
  ])('enforces bounded resources: %j', async limits => {
    await expect(previewSlackExport(zip(fixture('enterprise')), limits)).rejects.toMatchObject({ code: 'limit_exceeded' });
  });
});
