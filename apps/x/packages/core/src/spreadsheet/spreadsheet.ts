// Shared spreadsheet read/modify/write logic. Consumed by the builtin
// spreadsheet-create/spreadsheet-edit tools and the spreadsheet:load IPC
// handler that feeds the renderer's read-only viewer.

import { z } from "zod";
import * as files from "../filesystem/files.js";

// SheetJS is loaded dynamically inside each entry point to avoid pulling it
// into the main bundle. The import path is computed so esbuild cannot
// statically resolve it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _importDynamic = new Function('mod', 'return import(mod)') as (mod: string) => Promise<any>;

// Vitest's VM provides no dynamic-import callback for Function-constructed
// code, so tests fall back to a require() resolved from the package cwd. The
// fallback is unreachable in the packaged app, where the Function import works.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadXlsxModule(): Promise<any> {
    try {
        return await _importDynamic("xlsx");
    } catch {
        const { createRequire } = await import("node:module");
        return createRequire(process.cwd() + "/__resolver__.js")("xlsx");
    }
}

export type CellValue = string | number | boolean | null;
export type SpreadsheetFormat = 'xlsx' | 'xls' | 'csv' | 'tsv';

export interface SheetInput {
    name?: string;
    rows: CellValue[][];
}

export interface SheetMeta {
    name: string;
    rowCount: number;
    columnCount: number;
}

export interface WorkbookMeta {
    path: string;
    resolvedPath: string;
    workspaceRelPath: string | null;
    format: SpreadsheetFormat;
    sheets: SheetMeta[];
    etag: string;
}

const CellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const SpreadsheetOpSchema = z.discriminatedUnion('op', [
    z.object({
        op: z.literal('setCells'),
        sheet: z.string().optional().describe('Sheet name (default: first sheet)'),
        cells: z.record(z.string(), CellValueSchema).describe('A1-notation address -> value, e.g. {"B2": 42}. null clears the cell.'),
    }),
    z.object({
        op: z.literal('setRange'),
        sheet: z.string().optional().describe('Sheet name (default: first sheet)'),
        start: z.string().describe('Top-left A1 anchor, e.g. "A1"'),
        rows: z.array(z.array(CellValueSchema)).min(1).describe('Row-major cell values written from the anchor'),
    }),
    z.object({
        op: z.literal('appendRows'),
        sheet: z.string().optional().describe('Sheet name (default: first sheet)'),
        rows: z.array(z.array(CellValueSchema)).min(1).describe('Rows appended after the last used row'),
    }),
    z.object({
        op: z.literal('clearRange'),
        sheet: z.string().optional().describe('Sheet name (default: first sheet)'),
        range: z.string().describe('A1-style range to clear, e.g. "A2:C10"'),
    }),
    z.object({
        op: z.literal('addSheet'),
        name: z.string().min(1),
        rows: z.array(z.array(CellValueSchema)).optional().describe('Optional initial rows'),
    }),
    z.object({
        op: z.literal('removeSheet'),
        name: z.string().min(1),
    }),
    z.object({
        op: z.literal('renameSheet'),
        from: z.string().min(1),
        to: z.string().min(1),
    }),
]);

export type SpreadsheetOp = z.infer<typeof SpreadsheetOpSchema>;

const MAX_PARSE_BYTES = 50 * 1024 * 1024;
const MAX_WINDOW_COLUMNS = 100;

export function spreadsheetFormatOf(inputPath: string): SpreadsheetFormat {
    const dot = inputPath.lastIndexOf('.');
    const ext = dot >= 0 ? inputPath.slice(dot + 1).toLowerCase() : '';
    if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || ext === 'tsv') return ext;
    throw new Error(`Unsupported spreadsheet format '.${ext}'. Supported: .xlsx, .xls, .csv, .tsv`);
}

function assertWritableFormat(format: SpreadsheetFormat): asserts format is 'xlsx' | 'csv' {
    if (format !== 'xlsx' && format !== 'csv') {
        throw new Error(`'.${format}' files cannot be written. Writable formats: .xlsx, .csv`);
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sheetDimensions(XLSX: any, ws: any): { rowCount: number; columnCount: number } {
    if (!ws?.['!ref']) return { rowCount: 0, columnCount: 0 };
    const range = XLSX.utils.decode_range(ws['!ref']);
    return { rowCount: range.e.r + 1, columnCount: range.e.c + 1 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sheetMetas(XLSX: any, wb: any): SheetMeta[] {
    return wb.SheetNames.map((name: string) => ({ name, ...sheetDimensions(XLSX, wb.Sheets[name]) }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveSheet(wb: any, format: SpreadsheetFormat, name: string | undefined): string {
    if (name === undefined) {
        if (wb.SheetNames.length === 0) throw new Error('Workbook has no sheets');
        return wb.SheetNames[0];
    }
    if (!wb.SheetNames.includes(name)) {
        if (format === 'csv' || format === 'tsv') {
            throw new Error(`CSV files have a single sheet ('${wb.SheetNames[0]}'); omit the sheet parameter`);
        }
        throw new Error(`Sheet '${name}' not found. Available: ${wb.SheetNames.join(', ')}`);
    }
    return name;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expandRef(XLSX: any, ws: any, addr: { r: number; c: number }): void {
    const range = ws['!ref']
        ? XLSX.utils.decode_range(ws['!ref'])
        : { s: { r: addr.r, c: addr.c }, e: { r: addr.r, c: addr.c } };
    range.s.r = Math.min(range.s.r, addr.r);
    range.s.c = Math.min(range.s.c, addr.c);
    range.e.r = Math.max(range.e.r, addr.r);
    range.e.c = Math.max(range.e.c, addr.c);
    ws['!ref'] = XLSX.utils.encode_range(range);
}

function toCellValue(value: unknown): CellValue {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

// Single-entry parse cache so viewer page flips don't re-parse a large
// workbook. Entries are only ever replaced whole; cached workbooks are never
// mutated (edits always re-read from disk).
let parseCache: { resolvedPath: string; etag: string; format: SpreadsheetFormat; workbook: unknown } | null = null;

async function readWorkbook(inputPath: string): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    XLSX: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workbook: any;
    format: SpreadsheetFormat;
    resolved: { path: string; resolvedPath: string; workspaceRelPath: string | null };
    etag: string;
}> {
    const format = spreadsheetFormatOf(inputPath);
    const XLSX = await loadXlsxModule();
    const stat = await files.stat(inputPath);
    if (stat.size > MAX_PARSE_BYTES) {
        throw new Error(`File is too large to open (${Math.round(stat.size / (1024 * 1024))} MB; limit is 50 MB)`);
    }
    const resolvedMeta = files.resolveFilePath(inputPath);
    const resolved = {
        path: resolvedMeta.originalPath,
        resolvedPath: resolvedMeta.resolvedPath,
        workspaceRelPath: resolvedMeta.workspaceRelPath,
    };

    if (parseCache && parseCache.resolvedPath === resolved.resolvedPath && parseCache.etag === stat.etag) {
        return { XLSX, workbook: parseCache.workbook, format: parseCache.format, resolved, etag: stat.etag };
    }

    const { buffer } = await files.readBuffer(inputPath);
    // codepage 65001 = UTF-8. Without it SheetJS decodes BOM-less CSV as
    // cp1252, and since this read also feeds applyWorkbookOps, an edit would
    // write the mis-decoded text back — corrupting non-ASCII cells the edit
    // never touched. Only affects CSV/text parsing; xlsx carries its own
    // encoding.
    const workbook = XLSX.read(buffer, { type: 'buffer', codepage: 65001 });
    parseCache = { resolvedPath: resolved.resolvedPath, etag: stat.etag, format, workbook };
    return { XLSX, workbook, format, resolved, etag: stat.etag };
}

async function writeWorkbook(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    XLSX: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    workbook: any,
    format: 'xlsx' | 'csv',
    inputPath: string,
    expectedEtag?: string,
): Promise<{ etag: string; resolvedPath: string; workspaceRelPath: string | null; path: string }> {
    const opts = expectedEtag ? { expectedEtag } : undefined;
    let result: { etag: string; resolvedPath: string; path: string };
    if (format === 'csv') {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
        result = await files.writeText(inputPath, csv, opts);
    } else {
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
        result = await files.writeBuffer(inputPath, buffer, opts);
    }
    const resolvedMeta = files.resolveFilePath(inputPath);
    // CSV re-parses get a fresh default sheet name, so the in-memory workbook
    // (which may carry a custom name) must not be cached for them.
    parseCache = format === 'xlsx'
        ? { resolvedPath: result.resolvedPath, etag: result.etag, format, workbook }
        : null;
    return { etag: result.etag, resolvedPath: result.resolvedPath, workspaceRelPath: resolvedMeta.workspaceRelPath, path: result.path };
}

export async function createWorkbook(
    inputPath: string,
    sheets: SheetInput[],
    opts?: { overwrite?: boolean },
): Promise<WorkbookMeta> {
    const format = spreadsheetFormatOf(inputPath);
    assertWritableFormat(format);
    if (sheets.length === 0) throw new Error('At least one sheet is required');
    if (format === 'csv' && sheets.length > 1) {
        throw new Error('CSV files have a single sheet; use .xlsx for multi-sheet workbooks');
    }

    const existing = await files.exists(inputPath);
    if (existing.exists && !opts?.overwrite) {
        throw new Error(`File already exists: ${existing.path}. Pass overwrite: true to replace it.`);
    }

    const XLSX = await loadXlsxModule();
    const workbook = XLSX.utils.book_new();
    sheets.forEach((sheet, index) => {
        const name = sheet.name ?? `Sheet${index + 1}`;
        const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
        XLSX.utils.book_append_sheet(workbook, ws, name);
    });

    const written = await writeWorkbook(XLSX, workbook, format, inputPath);
    return {
        path: written.path,
        resolvedPath: written.resolvedPath,
        workspaceRelPath: written.workspaceRelPath,
        format,
        sheets: sheetMetas(XLSX, workbook),
        etag: written.etag,
    };
}

export async function applyWorkbookOps(
    inputPath: string,
    ops: SpreadsheetOp[],
): Promise<WorkbookMeta & { changed: { sheets: string[] } }> {
    if (ops.length === 0) throw new Error('At least one operation is required');
    const format = spreadsheetFormatOf(inputPath);
    assertWritableFormat(format);

    // Edits always re-parse from disk (never the shared cache) so the cached
    // workbook object is never mutated behind the viewer's back.
    parseCache = null;
    const { XLSX, workbook, etag } = await readWorkbook(inputPath);
    parseCache = null;

    const changed = new Set<string>();
    for (const op of ops) {
        switch (op.op) {
            case 'setCells': {
                const sheetName = resolveSheet(workbook, format, op.sheet);
                const ws = workbook.Sheets[sheetName];
                for (const [addr, value] of Object.entries(op.cells)) {
                    const cell = XLSX.utils.decode_cell(addr);
                    if (Number.isNaN(cell.r) || Number.isNaN(cell.c) || cell.r < 0 || cell.c < 0) {
                        throw new Error(`Invalid cell address '${addr}'`);
                    }
                    const key = XLSX.utils.encode_cell(cell);
                    if (value === null) {
                        delete ws[key];
                    } else if (typeof value === 'number') {
                        ws[key] = { t: 'n', v: value };
                        expandRef(XLSX, ws, cell);
                    } else if (typeof value === 'boolean') {
                        ws[key] = { t: 'b', v: value };
                        expandRef(XLSX, ws, cell);
                    } else {
                        ws[key] = { t: 's', v: value };
                        expandRef(XLSX, ws, cell);
                    }
                }
                changed.add(sheetName);
                break;
            }
            case 'setRange': {
                const sheetName = resolveSheet(workbook, format, op.sheet);
                XLSX.utils.sheet_add_aoa(workbook.Sheets[sheetName], op.rows, { origin: op.start });
                changed.add(sheetName);
                break;
            }
            case 'appendRows': {
                const sheetName = resolveSheet(workbook, format, op.sheet);
                const ws = workbook.Sheets[sheetName];
                // A sheet that roundtripped empty keeps a phantom A1:A1 !ref;
                // origin -1 would then append below a blank first row.
                const hasCells = Object.keys(ws).some((key) => !key.startsWith('!'));
                XLSX.utils.sheet_add_aoa(ws, op.rows, { origin: hasCells ? -1 : 'A1' });
                changed.add(sheetName);
                break;
            }
            case 'clearRange': {
                const sheetName = resolveSheet(workbook, format, op.sheet);
                const ws = workbook.Sheets[sheetName];
                const range = XLSX.utils.decode_range(op.range);
                for (let r = range.s.r; r <= range.e.r; r++) {
                    for (let c = range.s.c; c <= range.e.c; c++) {
                        delete ws[XLSX.utils.encode_cell({ r, c })];
                    }
                }
                changed.add(sheetName);
                break;
            }
            case 'addSheet': {
                if (format === 'csv') throw new Error('CSV files have a single sheet; sheet operations require .xlsx');
                if (workbook.SheetNames.includes(op.name)) throw new Error(`Sheet '${op.name}' already exists`);
                XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(op.rows ?? []), op.name);
                changed.add(op.name);
                break;
            }
            case 'removeSheet': {
                if (format === 'csv') throw new Error('CSV files have a single sheet; sheet operations require .xlsx');
                if (!workbook.SheetNames.includes(op.name)) {
                    throw new Error(`Sheet '${op.name}' not found. Available: ${workbook.SheetNames.join(', ')}`);
                }
                if (workbook.SheetNames.length === 1) throw new Error('Cannot remove the only sheet in a workbook');
                workbook.SheetNames = workbook.SheetNames.filter((n: string) => n !== op.name);
                delete workbook.Sheets[op.name];
                changed.add(op.name);
                break;
            }
            case 'renameSheet': {
                if (format === 'csv') throw new Error('CSV files have a single sheet; sheet operations require .xlsx');
                if (!workbook.SheetNames.includes(op.from)) {
                    throw new Error(`Sheet '${op.from}' not found. Available: ${workbook.SheetNames.join(', ')}`);
                }
                if (workbook.SheetNames.includes(op.to)) throw new Error(`Sheet '${op.to}' already exists`);
                workbook.SheetNames = workbook.SheetNames.map((n: string) => (n === op.from ? op.to : n));
                workbook.Sheets[op.to] = workbook.Sheets[op.from];
                delete workbook.Sheets[op.from];
                changed.add(op.to);
                break;
            }
        }
    }

    const written = await writeWorkbook(XLSX, workbook, format, inputPath, etag);
    return {
        path: written.path,
        resolvedPath: written.resolvedPath,
        workspaceRelPath: written.workspaceRelPath,
        format,
        sheets: sheetMetas(XLSX, workbook),
        etag: written.etag,
        changed: { sheets: [...changed] },
    };
}

// Windowed read returning raw values (type info for alignment and copy) plus
// formatted display text (dates, currency, percents render as in Excel).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readWindow(XLSX: any, ws: any, offset: number, limit: number, rowCount: number, columnCount: number): {
    rows: CellValue[][];
    display: (string | null)[][];
} {
    if (rowCount === 0 || offset >= rowCount) return { rows: [], display: [] };
    const range = {
        s: { r: offset, c: 0 },
        e: { r: Math.min(offset + limit, rowCount) - 1, c: Math.min(columnCount, MAX_WINDOW_COLUMNS) - 1 },
    };
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true, range }) as unknown[][];
    const formatted = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true, raw: false, range }) as unknown[][];
    return {
        rows: raw.map((row) => row.map(toCellValue)),
        display: formatted.map((row) => row.map((v) => (v === null || v === undefined ? null : String(v)))),
    };
}

export async function loadSheetWindow(
    inputPath: string,
    sheet: string | undefined,
    offset: number,
    limit: number,
): Promise<{
    meta: WorkbookMeta;
    activeSheet: string;
    rows: CellValue[][];
    display: (string | null)[][];
    firstRow: CellValue[] | null;
    firstRowDisplay: (string | null)[] | null;
    offset: number;
    totalRows: number;
    totalColumns: number;
}> {
    if (offset < 0 || limit < 1) throw new Error('offset must be >= 0 and limit >= 1');
    const { XLSX, workbook, format, resolved, etag } = await readWorkbook(inputPath);
    const activeSheet = resolveSheet(workbook, format, sheet);
    const ws = workbook.Sheets[activeSheet];
    const { rowCount, columnCount } = sheetDimensions(XLSX, ws);

    const win = readWindow(XLSX, ws, offset, limit, rowCount, columnCount);
    // Row 1 rides along on every window so the viewer can pin it as a header
    // while paging through the rest of the sheet.
    const first = offset === 0 && win.rows.length > 0
        ? { rows: win.rows.slice(0, 1), display: win.display.slice(0, 1) }
        : readWindow(XLSX, ws, 0, 1, rowCount, columnCount);

    return {
        meta: {
            path: resolved.path,
            resolvedPath: resolved.resolvedPath,
            workspaceRelPath: resolved.workspaceRelPath,
            format,
            sheets: sheetMetas(XLSX, workbook),
            etag,
        },
        activeSheet,
        rows: win.rows,
        display: win.display,
        firstRow: first.rows[0] ?? null,
        firstRowDisplay: first.display[0] ?? null,
        offset,
        totalRows: rowCount,
        totalColumns: columnCount,
    };
}

export async function findInSheet(
    inputPath: string,
    sheet: string | undefined,
    query: string,
    maxMatches = 1000,
): Promise<{ activeSheet: string; matches: Array<{ row: number; col: number }>; total: number }> {
    const { XLSX, workbook, format } = await readWorkbook(inputPath);
    const activeSheet = resolveSheet(workbook, format, sheet);
    const needle = query.trim().toLowerCase();
    if (!needle) return { activeSheet, matches: [], total: 0 };

    const ws = workbook.Sheets[activeSheet];
    const matches: Array<{ row: number; col: number }> = [];
    for (const [key, cell] of Object.entries(ws)) {
        if (key.startsWith('!')) continue;
        const c = cell as { v?: unknown; w?: string } | null;
        if (!c || typeof c !== 'object' || c.v === undefined || c.v === null) continue;
        const addr = XLSX.utils.decode_cell(key);
        // Columns past the window cap never render, so a match there would be
        // unreachable in the viewer.
        if (addr.c >= MAX_WINDOW_COLUMNS) continue;
        const display = typeof c.w === 'string' ? c.w.toLowerCase() : '';
        const raw = typeof c.v === 'object' ? '' : String(c.v).toLowerCase();
        if (display.includes(needle) || raw.includes(needle)) {
            matches.push({ row: addr.r, col: addr.c });
        }
    }
    matches.sort((a, b) => (a.row - b.row) || (a.col - b.col));
    return { activeSheet, matches: matches.slice(0, maxMatches), total: matches.length };
}
