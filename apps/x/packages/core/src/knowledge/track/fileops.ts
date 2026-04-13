import z from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { WorkDir } from '../../config/config.js';
import { TrackBlockSchema } from '@x/shared/dist/track-block.js';
import { TrackStateSchema } from './types.js';

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

export async function updateContent(filePath: string, trackId: string, newContent: string): Promise<void> {
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
}

export async function updateTrackBlock(filepath: string, trackId: string, updates: Partial<z.infer<typeof TrackBlockSchema>>): Promise<void> {
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
}