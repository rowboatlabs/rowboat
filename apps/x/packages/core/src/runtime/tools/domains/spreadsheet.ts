// Builtin tools: spreadsheet domain. Create and edit local .xlsx/.csv files
// via the shared spreadsheet module; reading stays with parseFile.

import { z } from "zod";
import { BuiltinToolsSchema } from "../types.js";
import {
    createWorkbook,
    applyWorkbookOps,
    SpreadsheetOpSchema,
    type SheetInput,
    type SpreadsheetOp,
} from "../../../spreadsheet/spreadsheet.js";

const CellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

function errorEnvelope(error: unknown): { success: false; error: string } {
    return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
    };
}

export const spreadsheetTools: z.infer<typeof BuiltinToolsSchema> = {
    'spreadsheet-create': {
        permission: "file-boundary",
        description: 'Create a spreadsheet file (.xlsx or .csv) from row data. CSV files hold exactly one sheet.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Destination file path ending in .xlsx or .csv. Can be absolute, ~/..., or relative to the default root.'),
            sheets: z.array(z.object({
                name: z.string().optional().describe('Sheet name (default Sheet1, Sheet2, ...)'),
                rows: z.array(z.array(CellValue)).describe('Row-major cell values; first row is typically headers'),
            })).min(1),
            overwrite: z.boolean().optional().describe('Replace the file if it already exists (default false)'),
        }),
        execute: async ({ path, sheets, overwrite }: { path: string; sheets: SheetInput[]; overwrite?: boolean }) => {
            try {
                const meta = await createWorkbook(path, sheets, { overwrite });
                return { success: true, ...meta, changed: { sheets: meta.sheets.map((s) => s.name) } };
            } catch (error) {
                return errorEnvelope(error);
            }
        },
    },

    'spreadsheet-edit': {
        permission: "file-boundary",
        description: 'Edit an existing .xlsx or .csv file: set cells/ranges (A1 notation), append rows, clear ranges, add/remove/rename sheets. Values are written as literals (not formulas) and existing cell styling may be dropped on edited files.',
        inputSchema: z.object({
            path: z.string().min(1).describe('Spreadsheet file path (.xlsx or .csv). Can be absolute, ~/..., or relative to the default root.'),
            ops: z.array(SpreadsheetOpSchema).min(1).describe('Operations applied in order in a single atomic write'),
        }),
        execute: async ({ path, ops }: { path: string; ops: SpreadsheetOp[] }) => {
            try {
                const result = await applyWorkbookOps(path, ops);
                return { success: true, ...result };
            } catch (error) {
                return errorEnvelope(error);
            }
        },
    },
};
