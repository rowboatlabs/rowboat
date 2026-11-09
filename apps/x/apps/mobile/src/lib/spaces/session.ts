// `/session <title>` (2026-11-07): the phone had no slash commands, so the
// command went out as a plain message and never marked a session (desktop
// #1321). The composer's text is checked here before it is sent.

/** The title typed after `/session` ('' when none), or null when the body is not the command. */
export function sessionTitleOf(body: string): string | null {
  const match = /^\/session(?:\s+([\s\S]*))?$/i.exec(body.trim());
  if (!match) return null;
  return (match[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** A thread's first line as a session title, when `/session` is typed with none (desktop threadLabelOf). */
export function sessionTitleFromBody(body: string): string {
  const line = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const label = line.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
  return (label || 'Session').slice(0, 200);
}
