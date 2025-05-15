import { createOpenAI } from "@ai-sdk/openai";

const EMBEDDING_PROVIDER_API_KEY = process.env.EMBEDDING_PROVIDER_API_KEY || process.env.OPENAI_API_KEY || '';
const EMBEDDING_PROVIDER_BASE_URL = process.env.EMBEDDING_PROVIDER_BASE_URL || undefined;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

const openai = createOpenAI({
    apiKey: EMBEDDING_PROVIDER_API_KEY,
    baseURL: EMBEDDING_PROVIDER_BASE_URL,
});

export const embeddingModel = openai.embedding(EMBEDDING_MODEL);