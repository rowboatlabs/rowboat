#!/usr/bin/env node
/**
 * Standalone pipeline runner for email labeling, graph building, and note tagging.
 *
 * Usage:
 *   npx tsx packages/core/src/knowledge/run_pipeline.ts --workdir /path/to/workdir
 *   npx tsx packages/core/src/knowledge/run_pipeline.ts --workdir /path/to/workdir --steps label,graph,tag
 *   npx tsx packages/core/src/knowledge/run_pipeline.ts --workdir /path/to/workdir --steps label
 *   npx tsx packages/core/src/knowledge/run_pipeline.ts --workdir /path/to/workdir --steps graph,tag
 *
 * The workdir should contain a gmail_sync/ folder with email markdown files.
 * Output notes are written to workdir/knowledge/.
 *
 * Steps:
 *   label  - Classify emails with YAML frontmatter labels
 *   graph  - Extract entities and create/update knowledge notes
 *   tag    - Add YAML frontmatter tags to knowledge notes
 *
 * If --steps is omitted, all three steps run in order: label → graph → tag
 */

import fs from 'fs';
import path from 'path';

// --- Parse CLI args before any core imports (WorkDir reads env at import time) ---

const VALID_STEPS = ['label', 'graph', 'tag'] as const;
type Step = typeof VALID_STEPS[number];

function parseArgs(): { workdir: string; steps: Step[]; concurrency: number } {
    const args = process.argv.slice(2);
    let workdir: string | undefined;
    let stepsRaw: string | undefined;
    let concurrency = 3;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--workdir' && args[i + 1]) {
            workdir = args[++i];
        } else if (args[i] === '--steps' && args[i + 1]) {
            stepsRaw = args[++i];
        } else if (args[i] === '--concurrency' && args[i + 1]) {
            concurrency = parseInt(args[++i], 10);
            if (isNaN(concurrency) || concurrency < 1) {
                console.error('Error: --concurrency must be a positive integer');
                process.exit(1);
            }
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
Usage: run_pipeline --workdir <path> [--steps label,graph,tag] [--concurrency N]

Options:
  --workdir <path>      Working directory containing gmail_sync/ folder (required)
  --steps <list>        Comma-separated steps to run: label, graph, tag (default: all)
  --concurrency <N>     Number of parallel batches for labeling (default: 3)
  --help, -h            Show this help message

Examples:
  run_pipeline --workdir ./my-emails
  run_pipeline --workdir ./my-emails --steps label --concurrency 5
  run_pipeline --workdir ./my-emails --steps label,graph
  run_pipeline --workdir ./my-emails --steps graph,tag
`);
            process.exit(0);
        }
    }

    if (!workdir) {
        console.error('Error: --workdir is required');
        process.exit(1);
    }

    // Resolve to absolute path
    workdir = path.resolve(workdir);

    if (!fs.existsSync(workdir)) {
        console.error(`Error: workdir does not exist: ${workdir}`);
        process.exit(1);
    }

    // Parse steps
    let steps: Step[];
    if (stepsRaw) {
        const requested = stepsRaw.split(',').map(s => s.trim().toLowerCase());
        const invalid = requested.filter(s => !VALID_STEPS.includes(s as Step));
        if (invalid.length > 0) {
            console.error(`Error: invalid steps: ${invalid.join(', ')}. Valid steps: ${VALID_STEPS.join(', ')}`);
            process.exit(1);
        }
        steps = requested as Step[];
    } else {
        steps = [...VALID_STEPS];
    }

    return { workdir, steps, concurrency };
}

const { workdir, steps, concurrency } = parseArgs();

// Set env BEFORE importing core modules (WorkDir is read at module load time)
process.env.ROWBOAT_WORKDIR = workdir;

// --- Now import core modules ---

async function main() {
    console.log(`[Pipeline] Working directory: ${workdir}`);
    console.log(`[Pipeline] Steps to run: ${steps.join(', ')}`);
    console.log(`[Pipeline] Concurrency: ${concurrency}`);
    console.log();

    // Verify gmail_sync exists if label or graph step is requested
    const gmailSyncDir = path.join(workdir, 'gmail_sync');
    if ((steps.includes('label') || steps.includes('graph')) && !fs.existsSync(gmailSyncDir)) {
        console.warn(`[Pipeline] Warning: gmail_sync/ folder not found in ${workdir}`);
    }

    const startTime = Date.now();

    if (steps.includes('label')) {
        console.log('[Pipeline] === Step 1: Email Labeling ===');
        const { processUnlabeledEmails } = await import('./label_emails.js');
        await processUnlabeledEmails(concurrency);
        console.log();
    }

    if (steps.includes('graph')) {
        console.log('[Pipeline] === Step 2: Graph Building ===');
        const { processAllSources } = await import('./build_graph.js');
        await processAllSources();
        console.log();
    }

    if (steps.includes('tag')) {
        console.log('[Pipeline] === Step 3: Note Tagging ===');
        const { processUntaggedNotes } = await import('./tag_notes.js');
        await processUntaggedNotes();
        console.log();
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[Pipeline] Done in ${elapsed}s`);

    // Output summary
    const knowledgeDir = path.join(workdir, 'knowledge');
    if (fs.existsSync(knowledgeDir)) {
        const countFiles = (dir: string): number => {
            let count = 0;
            for (const entry of fs.readdirSync(dir)) {
                const full = path.join(dir, entry);
                const stat = fs.statSync(full);
                if (stat.isDirectory()) count += countFiles(full);
                else if (entry.endsWith('.md')) count++;
            }
            return count;
        };
        console.log(`[Pipeline] Output: ${countFiles(knowledgeDir)} notes in ${knowledgeDir}`);
    }
}

main().then(() => {
    process.exit(0);
}).catch((err) => {
    console.error('[Pipeline] Fatal error:', err);
    process.exit(1);
});
