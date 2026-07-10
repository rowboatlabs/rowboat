// Builtin tools: parsing domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import * as path from "path";
import * as files from "../../../filesystem/files.js";
import { generateText } from "ai";
import { createLanguageModel } from "../../../models/models.js";
import { getDefaultModelAndProvider, resolveProviderConfig } from "../../../models/defaults.js";
import { captureLlmUsage } from "../../../analytics/usage.js";
import { getCurrentUseCase, withUseCase } from "../../../analytics/use_case.js";
import {
    _importDynamic,
    BuiltinToolsSchema,
    LLMPARSE_MIME_TYPES,
} from "./support.js";


export const parsingTools: z.infer<typeof BuiltinToolsSchema> = {
    'parseFile': {
        description: 'Parse and extract text content from files (PDF, Excel, CSV, Word .docx). Auto-detects format from file extension.',
        inputSchema: z.object({
            path: z.string().min(1).describe('File path to parse. Can be absolute, ~/..., or relative to the default root.'),
        }),
        execute: async ({ path: filePath }: { path: string }) => {
            try {
                const fileName = path.basename(filePath);
                const ext = path.extname(filePath).toLowerCase();
                const supportedExts = ['.pdf', '.xlsx', '.xls', '.csv', '.docx'];

                if (!supportedExts.includes(ext)) {
                    return {
                        success: false,
                        error: `Unsupported file format '${ext}'. Supported formats: ${supportedExts.join(', ')}`,
                    };
                }

                const { buffer, resolvedPath } = await files.readBuffer(filePath);

                if (ext === '.pdf') {
                    const { PDFParse } = await _importDynamic("pdf-parse");
                    const parser = new PDFParse({ data: new Uint8Array(buffer) });
                    try {
                        const textResult = await parser.getText();
                        const infoResult = await parser.getInfo();
                        return {
                            success: true,
                            fileName,
                            format: 'pdf',
                            content: textResult.text,
                            metadata: {
                                pages: textResult.total,
                                title: infoResult.info?.Title || undefined,
                                author: infoResult.info?.Author || undefined,
                                resolvedPath,
                            },
                        };
                    } finally {
                        await parser.destroy();
                    }
                }

                if (ext === '.xlsx' || ext === '.xls') {
                    const XLSX = await _importDynamic("xlsx");
                    const workbook = XLSX.read(buffer, { type: 'buffer' });
                    const sheets: Record<string, string> = {};
                    for (const sheetName of workbook.SheetNames) {
                        const sheet = workbook.Sheets[sheetName];
                        sheets[sheetName] = XLSX.utils.sheet_to_csv(sheet);
                    }
                    return {
                        success: true,
                        fileName,
                        format: ext === '.xlsx' ? 'xlsx' : 'xls',
                        content: Object.values(sheets).join('\n\n'),
                        metadata: {
                            sheetNames: workbook.SheetNames,
                            sheetCount: workbook.SheetNames.length,
                        },
                        sheets,
                    };
                }

                if (ext === '.csv') {
                    const Papa = (await _importDynamic("papaparse")).default;
                    const text = buffer.toString('utf8');
                    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
                    return {
                        success: true,
                        fileName,
                        format: 'csv',
                        content: text,
                        metadata: {
                            rowCount: parsed.data.length,
                            headers: parsed.meta.fields || [],
                        },
                        data: parsed.data,
                    };
                }

                if (ext === '.docx') {
                    const mammoth = (await _importDynamic("mammoth")).default;
                    const docResult = await mammoth.extractRawText({ buffer });
                    return {
                        success: true,
                        fileName,
                        format: 'docx',
                        content: docResult.value,
                    };
                }

                return { success: false, error: 'Unexpected error' };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },

    'LLMParse': {
        description: 'Send a file to the configured LLM as a multimodal attachment and ask it to extract content as markdown. Best for scanned PDFs, images with text, complex layouts, or any format where local parsing falls short. Supports documents (PDF, Word, Excel, PowerPoint, CSV, TXT, HTML) and images (PNG, JPG, GIF, WebP, SVG, BMP, TIFF).',
        inputSchema: z.object({
            path: z.string().min(1).describe('File path to parse. Can be absolute, ~/..., or relative to the default root.'),
            prompt: z.string().optional().describe('Custom instruction for the LLM (defaults to "Convert this file to well-structured markdown.")'),
        }),
        execute: async ({ path: filePath, prompt }: { path: string; prompt?: string }) => {
            try {
                const fileName = path.basename(filePath);
                const ext = path.extname(filePath).toLowerCase();
                const mimeType = LLMPARSE_MIME_TYPES[ext];

                if (!mimeType) {
                    return {
                        success: false,
                        error: `Unsupported file format '${ext}'. Supported formats: ${Object.keys(LLMPARSE_MIME_TYPES).join(', ')}`,
                    };
                }

                const { buffer } = await files.readBuffer(filePath);

                const base64 = buffer.toString('base64');

                const { model: modelId, provider: providerName } = await getDefaultModelAndProvider();
                const providerConfig = await resolveProviderConfig(providerName);
                const model = createLanguageModel(providerConfig, modelId);

                const userPrompt = prompt || 'Convert this file to well-structured markdown.';

                const ctx = getCurrentUseCase();
                const response = await withUseCase({
                    useCase: ctx?.useCase ?? 'copilot_chat',
                    subUseCase: 'file_parse',
                    ...(ctx?.agentName ? { agentName: ctx.agentName } : {}),
                }, () => generateText({
                    model,
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { type: 'text', text: userPrompt },
                                { type: 'file', data: base64, mediaType: mimeType },
                            ],
                        },
                    ],
                }));

                captureLlmUsage({
                    useCase: ctx?.useCase ?? 'copilot_chat',
                    subUseCase: 'file_parse',
                    ...(ctx?.agentName ? { agentName: ctx.agentName } : {}),
                    model: modelId,
                    provider: providerName,
                    usage: response.usage,
                });

                return {
                    success: true,
                    fileName,
                    format: ext.slice(1),
                    mimeType,
                    content: response.text,
                    usage: response.usage,
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
    },
};
