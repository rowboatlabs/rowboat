# Knowledge Graph System

This directory contains the knowledge graph building system that processes emails and meeting transcripts to create an Obsidian-style knowledge base.

## Components

### `build_graph.ts`
Main orchestrator that:
- Processes source files (emails/transcripts) in batches
- Runs the `note_creation` agent to extract entities
- Only processes new or changed files (tracked via state)

### `graph_state.ts`
State management module that tracks which files have been processed:
- Uses hybrid mtime + hash approach for change detection
- Stores state in `~/.rowboat/knowledge_graph_state.json`
- Provides modular functions for state operations

### `sync_gmail.ts` & `sync_fireflies.ts`
Sync scripts that:
- Pull data from Gmail and Fireflies
- Save as markdown files in their respective directories
- Trigger knowledge graph build after successful sync

## How It Works

### Change Detection Strategy

The system uses a **hybrid mtime + hash approach**:

1. **Quick check**: Compare file modification time (mtime)
   - If mtime unchanged → file definitely hasn't changed → skip

2. **Verification**: If mtime changed, compute content hash
   - If hash unchanged → false positive (mtime changed but content didn't) → skip
   - If hash changed → file actually changed → process

This is efficient (only hashes potentially changed files) and reliable (confirms actual content changes).

### State File Structure

`~/.rowboat/knowledge_graph_state.json`:
```json
{
  "processedFiles": {
    "/path/to/file.md": {
      "mtime": "2026-01-07T10:30:00.000Z",
      "hash": "a3f5e9d2c8b1...",
      "lastProcessed": "2026-01-07T10:35:00.000Z"
    }
  },
  "lastBuildTime": "2026-01-07T10:35:00.000Z"
}
```

### Processing Flow

1. **Sync runs** (Gmail or Fireflies)
   - Fetches new/updated data
   - Saves as markdown files
   - Calls `buildGraph(SYNC_DIR)`

2. **buildGraph()**
   - Loads state
   - Scans source directory for files
   - Filters to only new/changed files
   - Processes in batches of 25
   - Updates state after each successful batch (saves progress incrementally)

3. **Agent processes batch**
   - Extracts entities (people, orgs, projects, topics)
   - Creates/updates notes in `~/.rowboat/knowledge/`
   - Merges information for entities appearing in multiple files

## Replacing the Change Detection Logic

The state management is modular. To implement a different change detection strategy:

### Option 1: Modify `graph_state.ts`

Replace the functions while keeping the same interface:

```typescript
// Current: mtime + hash
export function hasFileChanged(filePath: string, state: GraphState): boolean {
    // Your custom logic here
}

export function markFileAsProcessed(filePath: string, state: GraphState): void {
    // Your custom tracking here
}
```

### Option 2: Create a new state module

Create `graph_state_v2.ts` with the same exported interface:

```typescript
export interface FileState { /* ... */ }
export interface GraphState { /* ... */ }
export function loadState(): GraphState { /* ... */ }
export function saveState(state: GraphState): void { /* ... */ }
export function getFilesToProcess(sourceDir: string, state: GraphState): string[] { /* ... */ }
export function markFileAsProcessed(filePath: string, state: GraphState): void { /* ... */ }
```

Then update the import in `build_graph.ts`:
```typescript
import { /* ... */ } from './graph_state_v2.js';
```

### Option 3: Pass a strategy object

Refactor to accept a change detection strategy:

```typescript
interface ChangeDetectionStrategy {
    hasFileChanged(filePath: string, state: GraphState): boolean;
    markFileAsProcessed(filePath: string, state: GraphState): void;
}

export async function buildGraph(sourceDir: string, strategy?: ChangeDetectionStrategy) {
    const detector = strategy || defaultStrategy;
    // Use detector.hasFileChanged(), etc.
}
```

## Resetting State

To force reprocessing of all files:

```typescript
import { resetGraphState } from './build_graph.js';

resetGraphState(); // Clears the state file
```

Or manually delete: `~/.rowboat/knowledge_graph_state.json`

## Configuration

### Batch Size
Change `BATCH_SIZE` in `build_graph.ts` (currently 25 files per batch)

### State File Location
Change `STATE_FILE` in `graph_state.ts` (currently `~/.rowboat/knowledge_graph_state.json`)

### Hash Algorithm
Change `crypto.createHash('sha256')` in `graph_state.ts` to use a different algorithm (md5, sha1, etc.)
