import z from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { WorkDir } from '../../config/config.js';
import { TrackBlockSchema } from '@x/shared/dist/track-block.js';
import { TrackStateSchema } from './types.js';
import { withFileLock } from '../file-lock.js';

const KNOWLEDGE_DIR = path.join(WorkDir, 'knowledge');

function absPath(filePath: string): string {
    return path.join(KNOWLEDGE_DIR, filePath);
}

export async function fetchAll(filePath: string): Promise<z.infer<typeof TrackStateSchema>[]> {
    let content: string;
    try {
        content = await fs.readFile(absPath(filePath), 'utf-8');
    } catch {
        return [];
    }

    const lines = content.split('\n');
    const blocks: z.infer<typeof TrackStateSchema>[] = [];
    let i = 0;
    const contentFenceStartMatcher = /<!--track-target:(.+)-->/;
    const contentFenceEndMatcher = /<!--\/track-target:(.+)-->/;
    while (i < lines.length) {
        if (lines[i].trim() === '```track') {
            const fenceStart = i;
            i++;
            const blockLines: string[] = [];
            while (i < lines.length && lines[i].trim() !== '```') {
                blockLines.push(lines[i]);
                i++;
            }
            try {
                const data = parseYaml(blockLines.join('\n'));
                const result = TrackBlockSchema.safeParse(data);
                if (result.success) {
                    blocks.push({ track: result.data, fenceStart, fenceEnd: i, content: '' });
                }
            } catch { /* skip */ }
        } else if (contentFenceStartMatcher.test(lines[i])) {
            const match = contentFenceStartMatcher.exec(lines[i]);
            if (match) {
                const trackId = match[1];
                // have we already collected this track block?
                const existingBlock = blocks.find(b => b.track.trackId === trackId);
                if (!existingBlock) {
                    i++;
                    continue;
                }
                const contentStart = i + 1;
                while (i < lines.length && !contentFenceEndMatcher.test(lines[i])) {
                    i++;
                }
                const contentEnd = i;
                existingBlock.content = lines.slice(contentStart, contentEnd).join('\n');
            }
        }
        i++;
    }
    return blocks;
}

export async function fetch(filePath: string, trackId: string): Promise<z.infer<typeof TrackStateSchema> | null> {
    const blocks = await fetchAll(filePath);
    return blocks.find(b => b.track.trackId === trackId) ?? null;
}

type TrackNoteSummary = {
    path: string;
    trackCount: number;
    createdAt: string | null;
    lastRunAt: string | null;
    isActive: boolean;
};

async function summarizeTrackNote(
    filePath: string,
    tracks: z.infer<typeof TrackStateSchema>[],
): Promise<TrackNoteSummary | null> {
    if (tracks.length === 0) return null;

    const stats = await fs.stat(absPath(filePath));
    const createdMs = stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.ctimeMs;

    let latestRunAt: string | null = null;
    let latestRunMs = -1;
    for (const { track } of tracks) {
        if (!track.lastRunAt) continue;
        const candidateMs = Date.parse(track.lastRunAt);
        if (Number.isNaN(candidateMs) || candidateMs <= latestRunMs) continue;
        latestRunMs = candidateMs;
        latestRunAt = track.lastRunAt;
    }

    return {
        path: `knowledge/${filePath}`,
        trackCount: tracks.length,
        createdAt: createdMs > 0 ? new Date(createdMs).toISOString() : null,
        lastRunAt: latestRunAt,
        isActive: tracks.every(({ track }) => track.active !== false),
    };
}

export async function listNotesWithTracks(): Promise<TrackNoteSummary[]> {
    async function walk(relativeDir = ''): Promise<string[]> {
        const dirPath = absPath(relativeDir);
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const files: string[] = [];

            for (const entry of entries) {
                if (entry.name.startsWith('.')) continue;

                const childRelPath = relativeDir
                    ? path.posix.join(relativeDir, entry.name)
                    : entry.name;

                if (entry.isDirectory()) {
                    files.push(...await walk(childRelPath));
                    continue;
                }

                if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
                    files.push(childRelPath);
                }
            }

            return files;
        } catch {
            return [];
        }
    }

    const markdownFiles = await walk();
    const notes = await Promise.all(markdownFiles.map(async (relativePath) => {
        try {
            const tracks = await fetchAll(relativePath);
            return await summarizeTrackNote(relativePath, tracks);
        } catch {
            return null;
        }
    }));

    return notes
        .filter((note): note is TrackNoteSummary => note !== null)
        .sort((a, b) => {
            const aName = path.basename(a.path, '.md').toLowerCase();
            const bName = path.basename(b.path, '.md').toLowerCase();
            if (aName !== bName) return aName.localeCompare(bName);
            return a.path.localeCompare(b.path);
        });
}

export async function setNoteTracksActive(filePath: string, active: boolean): Promise<TrackNoteSummary | null> {
    return withFileLock(absPath(filePath), async () => {
        const blocks = await fetchAll(filePath);
        if (blocks.length === 0) return null;

        const alreadyMatches = blocks.every(({ track }) => (track.active !== false) === active);
        if (alreadyMatches) {
            return summarizeTrackNote(filePath, blocks);
        }

        const content = await fs.readFile(absPath(filePath), 'utf-8');
        const lines = content.split('\n');
        const updatedBlocks = blocks
            .map((block) => ({
                ...block,
                track: { ...block.track, active },
            }))
            .sort((a, b) => b.fenceStart - a.fenceStart);

        for (const block of updatedBlocks) {
            const yaml = stringifyYaml(block.track).trimEnd();
            const yamlLines = yaml ? yaml.split('\n') : [];
            lines.splice(block.fenceStart, block.fenceEnd - block.fenceStart + 1, '```track', ...yamlLines, '```');
        }

        await fs.writeFile(absPath(filePath), lines.join('\n'), 'utf-8');
        return summarizeTrackNote(filePath, updatedBlocks);
    });
}

/**
 * Fetch a track block and return its canonical YAML string (or null if not found).
 * Useful for IPC handlers that need to return the fresh YAML without taking a
 * dependency on the `yaml` package themselves.
 */
export async function fetchYaml(filePath: string, trackId: string): Promise<string | null> {
    const block = await fetch(filePath, trackId);
    if (!block) return null;
    return stringifyYaml(block.track).trimEnd();
}

export async function updateContent(filePath: string, trackId: string, newContent: string): Promise<void> {
    return withFileLock(absPath(filePath), async () => {
        let content = await fs.readFile(absPath(filePath), 'utf-8');
        const openTag = `<!--track-target:${trackId}-->`;
        const closeTag = `<!--/track-target:${trackId}-->`;
        const openIdx = content.indexOf(openTag);
        const closeIdx = content.indexOf(closeTag);
        if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
            content = content.slice(0, openIdx + openTag.length) + '\n' + newContent + '\n' + content.slice(closeIdx);
        } else {
            const block = await fetch(filePath, trackId);
            if (!block) {
                throw new Error(`Track ${trackId} not found in ${filePath}`);
            }
            const lines = content.split('\n');
            const insertAt = Math.min(block.fenceEnd + 1, lines.length);
            const contentFence = [openTag, newContent, closeTag];
            lines.splice(insertAt, 0, ...contentFence);
            content = lines.join('\n');
        }
        await fs.writeFile(absPath(filePath), content, 'utf-8');
    });
}

export async function updateTrackBlock(filepath: string, trackId: string, updates: Partial<z.infer<typeof TrackBlockSchema>>): Promise<void> {
    return withFileLock(absPath(filepath), async () => {
        const block = await fetch(filepath, trackId);
        if (!block) {
            throw new Error(`Track ${trackId} not found in ${filepath}`);
        }
        block.track = { ...block.track, ...updates };

        // read file contents
        let content = await fs.readFile(absPath(filepath), 'utf-8');
        const lines = content.split('\n');
        const yaml = stringifyYaml(block.track).trimEnd();
        const yamlLines = yaml ? yaml.split('\n') : [];
        lines.splice(block.fenceStart, block.fenceEnd - block.fenceStart + 1, '```track', ...yamlLines, '```');
        content = lines.join('\n');
        await fs.writeFile(absPath(filepath), content, 'utf-8');
    });
}

/**
 * Replace the entire YAML of a track block on disk with a new string.
 * Unlike updateTrackBlock (which merges), this writes the raw YAML verbatim —
 * used when the user explicitly edits raw YAML in the modal.
 * The new YAML must still parse to a valid TrackBlock with a matching trackId,
 * otherwise the write is rejected.
 */
export async function replaceTrackBlockYaml(filePath: string, trackId: string, newYaml: string): Promise<void> {
    return withFileLock(absPath(filePath), async () => {
        const block = await fetch(filePath, trackId);
        if (!block) {
            throw new Error(`Track ${trackId} not found in ${filePath}`);
        }
        const parsed = TrackBlockSchema.safeParse(parseYaml(newYaml));
        if (!parsed.success) {
            throw new Error(`Invalid track YAML: ${parsed.error.message}`);
        }
        if (parsed.data.trackId !== trackId) {
            throw new Error(`trackId cannot be changed (was "${trackId}", got "${parsed.data.trackId}")`);
        }

        const content = await fs.readFile(absPath(filePath), 'utf-8');
        const lines = content.split('\n');
        const yamlLines = newYaml.trimEnd().split('\n');
        lines.splice(block.fenceStart, block.fenceEnd - block.fenceStart + 1, '```track', ...yamlLines, '```');
        await fs.writeFile(absPath(filePath), lines.join('\n'), 'utf-8');
    });
}

/**
 * Remove a track block and its sibling target region from the file.
 */
export async function deleteTrackBlock(filePath: string, trackId: string): Promise<void> {
    return withFileLock(absPath(filePath), async () => {
        const block = await fetch(filePath, trackId);
        if (!block) {
            // Already gone — treat as success.
            return;
        }

        const content = await fs.readFile(absPath(filePath), 'utf-8');
        const lines = content.split('\n');
        const openTag = `<!--track-target:${trackId}-->`;
        const closeTag = `<!--/track-target:${trackId}-->`;

        // Find target region (may not exist)
        let targetStart = -1;
        let targetEnd = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(openTag)) { targetStart = i; }
            if (targetStart !== -1 && lines[i].includes(closeTag)) { targetEnd = i; break; }
        }

        // Build a list of [start, end] ranges to remove, sorted descending so
        // indices stay valid as we splice.
        const ranges: Array<[number, number]> = [];
        ranges.push([block.fenceStart, block.fenceEnd]);
        if (targetStart !== -1 && targetEnd !== -1 && targetEnd >= targetStart) {
            ranges.push([targetStart, targetEnd]);
        }
        ranges.sort((a, b) => b[0] - a[0]);

        for (const [start, end] of ranges) {
            lines.splice(start, end - start + 1);
            // Also drop a trailing blank line if the removal left two in a row.
            if (start < lines.length && lines[start].trim() === '' && start > 0 && lines[start - 1].trim() === '') {
                lines.splice(start, 1);
            }
        }

        await fs.writeFile(absPath(filePath), lines.join('\n'), 'utf-8');
    });
}
