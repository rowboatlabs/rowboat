import fs from 'fs/promises';
import path from 'path';
import type {
    AppSummary,
    RowboatAppManifest,
} from '@x/shared/dist/rowboat-app.js';

type Readiness = Pick<
    AppSummary,
    'readiness' | 'readinessMessage' | 'dataUpdatedAt'
>;

// Filesystem readiness is deliberately separate from browser health: an entry
// and valid data make an app ready to open, not proof that its JS works.
export async function inspectReadiness(
    dir: string,
    manifest?: RowboatAppManifest,
): Promise<Readiness> {
    if (!manifest)
        return {
            readiness: 'error',
            readinessMessage: 'This app needs a repair before it can open.',
        };
    if (manifest.buildStatus === 'failed')
        return {
            readiness: 'error',
            readinessMessage:
                'The build needs attention. Continue with the copilot to repair it.',
        };
    if (manifest.buildStatus === 'building')
        return {
            readiness: 'building',
            readinessMessage:
                'The app is being built. Continue in the copilot if the build has stopped.',
        };
    const confined = (root: string, rel: string) => {
        const absolute = path.resolve(root, rel);
        return absolute.startsWith(`${path.resolve(root)}${path.sep}`)
            ? absolute
            : null;
    };
    const entry = confined(path.join(dir, 'dist'), manifest.entry);
    try {
        if (
            !entry ||
            !(await fs.stat(entry)).isFile() ||
            !(await fs.stat(entry)).size
        )
            throw new Error('missing');
    } catch {
        return {
            readiness: 'building',
            readinessMessage:
                'The app’s page is not finished yet. Continue building with the copilot.',
        };
    }
    let dataUpdatedAt: string | undefined;
    for (const contract of manifest.dataContracts) {
        const file = confined(path.join(dir, 'data'), contract.file);
        try {
            if (!file) throw new Error('Invalid data path');
            // Do not follow a data symlink outside the app.
            const real = await fs.realpath(file);
            const root = await fs.realpath(path.join(dir, 'data'));
            if (!real.startsWith(`${root}${path.sep}`))
                throw new Error('Invalid data path');
            const stat = await fs.stat(file);
            if (stat.size > 50 * 1024 * 1024)
                throw new Error('Data is too large');
            const value = JSON.parse(await fs.readFile(file, 'utf8'));
            if (
                !value ||
                typeof value !== 'object' ||
                contract.requiredKeys.some((k) => value[k] == null) ||
                contract.nonEmptyArrayKeys.some(
                    (k) => !Array.isArray(value[k]) || !value[k].length,
                )
            )
                throw new Error('Incomplete data');
            // Oldest required file represents freshness of the complete app.
            const modified = stat.mtime.toISOString();
            if (!dataUpdatedAt || modified < dataUpdatedAt)
                dataUpdatedAt = modified;
        } catch {
            return {
                readiness: 'setup',
                readinessMessage:
                    'Waiting for the first complete data update. Run its agents or ask the copilot to finish setup.',
            };
        }
    }
    return { readiness: 'ready', ...(dataUpdatedAt ? { dataUpdatedAt } : {}) };
}
