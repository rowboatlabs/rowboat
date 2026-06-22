import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkDir } from '../config/config.js';
import { getKnowledgeIndex } from './knowledge_index.js';

const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');

/**
 * A calendar attendee as it arrives from the renderer (sourced from the
 * Google Calendar event's `attendees[]`).
 */
export interface MeetingPrepAttendee {
    email?: string;
    displayName?: string;
    self?: boolean;
}

/**
 * The note we resolved for a matched attendee. `markdown` is the full note
 * body so the renderer can render it as-is — no LLM, no summarisation.
 */
export interface MeetingPrepNote {
    /** Workspace-relative path, e.g. "knowledge/People/Sarah Chen.md". */
    path: string;
    name: string;
    role?: string;
    organization?: string;
    markdown: string;
}

/**
 * One attendee after resolution. `note` is set when we found a person note,
 * `null` otherwise (the "no note yet" case the UI offers to create).
 */
export interface MeetingPrepResolved {
    /** Best display label — the note name, else displayName, else email. */
    label: string;
    email?: string;
    displayName?: string;
    note: MeetingPrepNote | null;
}

/** An organization note relevant to the meeting (resolved from attendee domains). */
export interface MeetingPrepOrg {
    path: string;
    name: string;
    markdown: string;
}

export interface MeetingPrepResult {
    /** Resolved attendees, matched ones first (notes-first ordering). */
    attendees: MeetingPrepResolved[];
    /** Distinct external organizations in the meeting that have a note. */
    organizations: MeetingPrepOrg[];
    /** How many have a note vs. not — convenience for the UI header. */
    matchedCount: number;
    unmatchedCount: number;
}

function norm(value: string | undefined): string {
    return (value ?? '').trim().toLowerCase();
}

/** Normalize a display name for matching: drop parenthetical suffixes like
 *  "(via Google Calendar)" / "(Guest)" that calendars sometimes append. */
function normName(value: string | undefined): string {
    return norm((value ?? '').replace(/\s*\([^)]*\)\s*$/g, ''));
}

/** Lowercased domain part of an email, or '' if there isn't one. */
function domainOf(email: string | undefined): string {
    const e = norm(email);
    const at = e.lastIndexOf('@');
    return at >= 0 ? e.slice(at + 1) : '';
}

/** Tidy a field value for display: strip a leading knowledge folder segment so
 *  a link target like "Organizations/Rowboat Labs" reads as "Rowboat Labs". */
function displayRef(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const m = value.match(/^(?:People|Organizations|Projects|Topics)\/(.+)$/i);
    return (m ? m[1] : value).trim() || undefined;
}

/**
 * Resolve a meeting's attendees against the knowledge base, returning each
 * attendee's existing person note (or null). Deterministic: email-exact match
 * first, then an unambiguous name/alias match on the display name.
 */
export async function resolveMeetingPrep(
    attendees: MeetingPrepAttendee[],
): Promise<MeetingPrepResult> {
    const index = getKnowledgeIndex();

    // email -> person (first wins; emails are effectively unique).
    const byEmail = new Map<string, (typeof index.people)[number]>();
    // normalized name/alias -> people that carry it (for ambiguity checks).
    const byName = new Map<string, (typeof index.people)[number][]>();

    for (const person of index.people) {
        const email = norm(person.email);
        if (email && !byEmail.has(email)) byEmail.set(email, person);

        for (const key of [person.name, ...person.aliases]) {
            const nk = normName(key);
            if (!nk) continue;
            const list = byName.get(nk) ?? [];
            list.push(person);
            byName.set(nk, list);
        }
    }

    // domain -> organization, and name/alias -> organization, for resolving the
    // companies in the meeting from attendee email domains.
    const orgByDomain = new Map<string, (typeof index.organizations)[number]>();
    const orgByName = new Map<string, (typeof index.organizations)[number]>();
    for (const org of index.organizations) {
        const d = norm(org.domain);
        if (d && !orgByDomain.has(d)) orgByDomain.set(d, org);
        for (const key of [org.name, ...org.aliases]) {
            const nk = norm(key);
            if (nk && !orgByName.has(nk)) orgByName.set(nk, org);
        }
    }

    // The user's own domain (from the self attendee) is "internal" — we never
    // surface the user's own company as meeting context.
    const selfDomain = domainOf(attendees.find((a) => a.self)?.email);

    // Cache note reads so a person listed under multiple keys is read once.
    const noteCache = new Map<string, MeetingPrepNote | null>();
    const readNote = async (person: (typeof index.people)[number]): Promise<MeetingPrepNote | null> => {
        if (noteCache.has(person.file)) return noteCache.get(person.file)!;
        let note: MeetingPrepNote | null = null;
        try {
            const markdown = await fs.readFile(path.join(KNOWLEDGE_DIR, person.file), 'utf-8');
            note = {
                path: path.posix.join('knowledge', person.file.split(path.sep).join('/')),
                name: person.name,
                role: displayRef(person.role),
                organization: displayRef(person.organization),
                markdown,
            };
        } catch {
            // Indexed file vanished between index build and read — treat as no note.
            note = null;
        }
        noteCache.set(person.file, note);
        return note;
    };

    const resolved: MeetingPrepResolved[] = [];
    const seenFiles = new Set<string>();
    // Distinct external orgs to surface, keyed by note file.
    const orgEntries = new Map<string, (typeof index.organizations)[number]>();

    for (const attendee of attendees) {
        if (attendee.self) continue;

        const email = norm(attendee.email);
        const displayName = normName(attendee.displayName);
        const domain = domainOf(attendee.email);

        let person = email ? byEmail.get(email) : undefined;
        if (!person && displayName) {
            const candidates = byName.get(displayName);
            // Only a single, unambiguous hit counts — never guess between two
            // people who happen to share a name.
            if (candidates && candidates.length === 1) person = candidates[0];
        }

        // Resolve the attendee's company — but only for external domains, so an
        // internal standup doesn't surface the user's own org note. Prefer a
        // domain match; fall back to the matched person's Organization field.
        if (domain && domain !== selfDomain) {
            const org =
                orgByDomain.get(domain) ??
                (person?.organization ? orgByName.get(norm(person.organization)) : undefined);
            if (org) orgEntries.set(org.file, org);
        }

        const label =
            person?.name ||
            attendee.displayName?.trim() ||
            attendee.email?.trim() ||
            'Unknown';

        const note = person ? await readNote(person) : null;
        // Dedupe: the same person can appear once even if the calendar lists
        // them twice (e.g. organizer + attendee).
        if (note && seenFiles.has(note.path)) continue;
        if (note) seenFiles.add(note.path);

        resolved.push({
            label,
            email: attendee.email?.trim() || undefined,
            displayName: attendee.displayName?.trim() || undefined,
            note,
        });
    }

    // Notes-first ordering; stable within each group.
    resolved.sort((a, b) => {
        if (Boolean(a.note) === Boolean(b.note)) return 0;
        return a.note ? -1 : 1;
    });

    // Read the resolved org notes (skip any whose file vanished).
    const organizations: MeetingPrepOrg[] = [];
    for (const org of orgEntries.values()) {
        try {
            const markdown = await fs.readFile(path.join(KNOWLEDGE_DIR, org.file), 'utf-8');
            organizations.push({
                path: path.posix.join('knowledge', org.file.split(path.sep).join('/')),
                name: org.name,
                markdown,
            });
        } catch {
            // Indexed file vanished between index build and read — skip it.
        }
    }

    const matchedCount = resolved.filter((a) => a.note).length;
    return {
        attendees: resolved,
        organizations,
        matchedCount,
        unmatchedCount: resolved.length - matchedCount,
    };
}
