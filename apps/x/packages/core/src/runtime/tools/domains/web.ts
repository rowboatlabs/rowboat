// Builtin tools: web domain. Entries moved VERBATIM from the historical
// monolith — the merge order in ../builtin-tools.ts preserves the original
// catalog key order (provider-payload bytes; see the key-order test there).

import { z } from "zod";
import * as path from "path";
import * as fs from "fs/promises";
import { WorkDir } from "../../../config/config.js";
import { isSignedIn } from "../../../account/account.js";
import { getAccessToken } from "../../../auth/tokens.js";
import { API_URL } from "../../../config/env.js";
import { BuiltinToolsSchema } from "../types.js";


export const webSearchTools: z.infer<typeof BuiltinToolsSchema> = {
    'web-search': {
        permission: "none",
        description: 'Search the web for articles, blog posts, papers, companies, people, news, or explore a topic in depth. Returns rich results with full text, highlights, and metadata.',
        inputSchema: z.object({
            query: z.string().describe('The search query'),
            numResults: z.number().optional().describe('Number of results to return (default: 5, max: 20)'),
            category: z.enum(['general', 'company', 'research paper', 'news', 'tweet', 'personal site', 'financial report', 'people']).optional().describe('Search category. Defaults to "general" which searches the entire web. Only use a specific category when the query is clearly about that type (e.g. "research paper" for academic papers, "company" for company info). For everyday queries like weather, restaurants, prices, how-to, etc., use "general" or omit entirely.'),
        }),
        isAvailable: async () => {
            if (await isSignedIn()) return true;
            try {
                const exaConfigPath = path.join(WorkDir, 'config', 'exa-search.json');
                const raw = await fs.readFile(exaConfigPath, 'utf8');
                const config = JSON.parse(raw);
                return !!config.apiKey;
            } catch {
                return false;
            }
        },
        execute: async ({ query, numResults, category }: { query: string; numResults?: number; category?: string }) => {
            try {
                const resultCount = Math.min(Math.max(numResults || 5, 1), 20);

                const reqBody: Record<string, unknown> = {
                    query,
                    numResults: resultCount,
                    type: 'auto',
                    contents: {
                        text: { maxCharacters: 1000 },
                        highlights: true,
                    },
                };
                if (category && category !== 'general') {
                    reqBody.category = category;
                }

                let response: Response;

                if (await isSignedIn()) {
                    // Use proxy
                    const accessToken = await getAccessToken();
                    response = await fetch(`${API_URL}/v1/search/exa`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(reqBody),
                    });
                } else {
                    // Read API key from config
                    const exaConfigPath = path.join(WorkDir, 'config', 'exa-search.json');

                    let apiKey: string;
                    try {
                        const raw = await fs.readFile(exaConfigPath, 'utf8');
                        const config = JSON.parse(raw);
                        apiKey = config.apiKey;
                    } catch {
                        return {
                            success: false,
                            error: `Exa Search API key not configured. Create ${exaConfigPath} with { "apiKey": "<your-key>" }`,
                        };
                    }

                    if (!apiKey) {
                        return {
                            success: false,
                            error: `Exa Search API key is empty. Set "apiKey" in ${exaConfigPath}`,
                        };
                    }

                    response = await fetch('https://api.exa.ai/search', {
                        method: 'POST',
                        headers: {
                            'x-api-key': apiKey,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(reqBody),
                    });
                }

                if (!response.ok) {
                    const text = await response.text();
                    return {
                        success: false,
                        error: `Exa Search API error (${response.status}): ${text}`,
                    };
                }

                const data = await response.json() as {
                    results?: Array<{
                        title?: string;
                        url?: string;
                        publishedDate?: string;
                        author?: string;
                        highlights?: string[];
                        text?: string;
                    }>;
                };

                const results = (data.results || []).map((r) => ({
                    title: r.title || '',
                    url: r.url || '',
                    publishedDate: r.publishedDate || '',
                    author: r.author || '',
                    highlights: r.highlights || [],
                    text: r.text || '',
                }));

                return {
                    success: true,
                    query,
                    results,
                    count: results.length,
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

export const fetchUrlTools: z.infer<typeof BuiltinToolsSchema> = {
    'fetch-url': {
        permission: "none",
        description: "Fetch an HTTP(S) URL and return the response body as text. Use this to pull data from web APIs or pages (e.g. a JSON endpoint) — especially in background tasks, which have no shell. GET by default; supports POST with a body. Returns { ok, status, statusText, body } (body truncated if very large). For JSON, parse the returned body.",
        inputSchema: z.object({
            url: z.string().describe('The http(s) URL to fetch.'),
            method: z.enum(['GET', 'POST']).optional().describe('HTTP method (default GET).'),
            headers: z.record(z.string(), z.string()).optional().describe('Optional request headers.'),
            body: z.string().optional().describe('Request body (for POST).'),
        }),
        execute: async ({ url, method, headers, body }: { url: string; method?: string; headers?: Record<string, string>; body?: string }) => {
            try {
                const parsed = new URL(url);
                if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                    return { ok: false, status: 0, error: 'Only http(s) URLs are allowed.' };
                }
                const m = (method || 'GET').toUpperCase();
                const res = await fetch(url, { method: m, headers, body: m === 'GET' || m === 'HEAD' ? undefined : body });
                let text = await res.text();
                const MAX = 200_000;
                const truncated = text.length > MAX;
                if (truncated) text = text.slice(0, MAX);
                return { ok: res.ok, status: res.status, statusText: res.statusText, body: text, truncated };
            } catch (e) {
                return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
            }
        },
    },
};
