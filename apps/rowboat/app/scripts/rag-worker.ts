import '../lib/loadenv';
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import FirecrawlApp from '@mendable/firecrawl-js';
import { z } from 'zod';
import { EmbeddingRecord } from "../lib/types/datasource_types";
import { DataSourceDoc } from "@/src/entities/models/data-source-doc";
import { embedMany, generateText } from 'ai';
import { embeddingModel } from '../lib/embedding';
import { qdrantClient } from '../lib/qdrant';
import { PrefixLogger } from "../lib/utils";
import { GoogleGenerativeAI } from "@google/generative-ai";
import crypto from 'crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { USE_BILLING, USE_GEMINI_FILE_PARSING } from '../lib/feature_flags';
import { authorize, getCustomerIdForProject, logUsage, UsageTracker } from '../lib/billing';
import { BillingError } from '@/src/entities/errors/common';
import { DataSource } from '@/src/entities/models/data-source';
import { IDataSourcesRepository } from '@/src/application/repositories/data-sources.repository.interface';
import { IDataSourceDocsRepository } from '@/src/application/repositories/data-source-docs.repository.interface';
import { IUploadsStorageService } from '@/src/application/services/uploads-storage.service.interface';
import { container } from '@/di/container';

const FILE_PARSING_PROVIDER_API_KEY = process.env.FILE_PARSING_PROVIDER_API_KEY || process.env.OPENAI_API_KEY || '';
const FILE_PARSING_PROVIDER_BASE_URL = process.env.FILE_PARSING_PROVIDER_BASE_URL || undefined;
const FILE_PARSING_MODEL = process.env.FILE_PARSING_MODEL || 'gpt-4o';

const dataSourcesRepository = container.resolve<IDataSourcesRepository>('dataSourcesRepository');
const dataSourceDocsRepository = container.resolve<IDataSourceDocsRepository>('dataSourceDocsRepository');
const localUploadsStorageService = container.resolve<IUploadsStorageService>('localUploadsStorageService');
const s3UploadsStorageService = container.resolve<IUploadsStorageService>('s3UploadsStorageService');

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY || "test" });

const openai = createOpenAI({
    apiKey: FILE_PARSING_PROVIDER_API_KEY,
    baseURL: FILE_PARSING_PROVIDER_BASE_URL,
});

const splitter = new RecursiveCharacterTextSplitter({
    separators: ['\n\n', '\n', '. ', '.', ''],
    chunkSize: 1024,
    chunkOverlap: 20,
});

// Configure Google Gemini API
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

async function retryable<T>(fn: () => Promise<T>, maxAttempts: number = 3): Promise<T> {
    let attempts = 0;
    while (true) {
        try {
            return await fn();
        } catch (e) {
            attempts++;
            if (attempts >= maxAttempts) {
                throw e;
            }
        }
    }
}

async function runProcessFilePipeline(_logger: PrefixLogger, usageTracker: UsageTracker, job: z.infer<typeof DataSource>, doc: z.infer<typeof DataSourceDoc>) {
    if (doc.data.type !== 'file_local' && doc.data.type !== 'file_s3') {
        throw new Error("Invalid data source type");
    }

    const logger = _logger
        .child(doc.id)
        .child(doc.name);

    // Get file content
    let fileData: Buffer;
    if (doc.data.type === 'file_local') {
        logger.log("Fetching file from local");
        fileData = await localUploadsStorageService.getFileContents(doc.id);
    } else {
        logger.log("Fetching file from S3");
        fileData = await s3UploadsStorageService.getFileContents(doc.id);
    }

    let markdown = "";
    const extractPrompt = "Extract and return only the text content from this document in markdown format. Exclude any formatting instructions or additional commentary.";
    if (!USE_GEMINI_FILE_PARSING) {
        // Use OpenAI to extract text content
        logger.log("Extracting content using OpenAI");
        const { text, usage } = await generateText({
            model: openai(FILE_PARSING_MODEL),
            system: extractPrompt,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "file",
                            data: fileData.toString('base64'),
                            mimeType: doc.data.mimeType,
                        }
                    ]
                }
            ],
        });
        markdown = text;
        usageTracker.track({
            type: "LLM_USAGE",
            modelName: FILE_PARSING_MODEL,
            inputTokens: usage.promptTokens,
            outputTokens: usage.completionTokens,
            context: "rag.files.llm_usage",
        });
    } else {
        // Use Gemini to extract text content
        logger.log("Extracting content using Gemini");
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-001" });

        const result = await model.generateContent([
            {
                inlineData: {
                    data: fileData.toString('base64'),
                    mimeType: doc.data.mimeType
                }
            },
            extractPrompt,
        ]);
        markdown = result.response.text();
        usageTracker.track({
            type: "LLM_USAGE",
            modelName: FILE_PARSING_MODEL,
            inputTokens: result.response.usageMetadata?.promptTokenCount || 0,
            outputTokens: result.response.usageMetadata?.candidatesTokenCount || 0,
            context: "rag.files.llm_usage",
        });
    }

    // split into chunks
    logger.log("Splitting into chunks");
    const splits = await splitter.createDocuments([markdown]);

    // generate embeddings
    logger.log("Generating embeddings");
    const { embeddings, usage } = await embedMany({
        model: embeddingModel,
        values: splits.map((split) => split.pageContent)
    });
    usageTracker.track({
        type: "EMBEDDING_MODEL_USAGE",
        modelName: embeddingModel.modelId,
        tokens: usage.tokens,
        context: "rag.files.embedding_usage",
    });

    // store embeddings in qdrant
    logger.log("Storing embeddings in Qdrant");
    const points: z.infer<typeof EmbeddingRecord>[] = embeddings.map((embedding, i) => ({
        id: crypto.randomUUID(),
        vector: embedding,
        payload: {
            projectId: job.projectId,
            sourceId: job.id,
            docId: doc.id,
            content: splits[i].pageContent,
            title: doc.name,
            name: doc.name,
        },
    }));
    await qdrantClient.upsert("embeddings", {
        points,
    });

    // store content in doc record
    logger.log("Storing content in doc record");
    await dataSourceDocsRepository.updateByVersion(doc.id, doc.version, {
        content: markdown,
        status: "ready",
    });
}

async function runScrapePipeline(_logger: PrefixLogger, usageTracker: UsageTracker, job: z.infer<typeof DataSource>, doc: z.infer<typeof DataSourceDoc>) {
    const logger = _logger
        .child(doc.id)
        .child(doc.name);

    // scrape the url using firecrawl
    logger.log("Scraping using Firecrawl");
    const scrapeResult = await retryable(async () => {
        if (doc.data.type !== 'url') {
            throw new Error("Invalid data source type");
        }
        const scrapeResult = await firecrawl.scrapeUrl(doc.data.url, {
            formats: ['markdown'],
            onlyMainContent: true,
            excludeTags: ['script', 'style', 'noscript', 'img',]
        });
        if (!scrapeResult.success) {
            throw new Error("Unable to scrape URL: " + doc.data.url);
        }
        return scrapeResult;
    }, 3); // Retry up to 3 times
    usageTracker.track({
        type: "FIRECRAWL_SCRAPE_USAGE",
        context: "rag.urls.firecrawl_scrape",
    });

    // split into chunks
    logger.log("Splitting into chunks");
    const splits = await splitter.createDocuments([scrapeResult.markdown || '']);

    // generate embeddings
    logger.log("Generating embeddings");
    const { embeddings, usage } = await embedMany({
        model: embeddingModel,
        values: splits.map((split) => split.pageContent)
    });
    usageTracker.track({
        type: "EMBEDDING_MODEL_USAGE",
        modelName: embeddingModel.modelId,
        tokens: usage.tokens,
        context: "rag.urls.embedding_usage",
    });

    // store embeddings in qdrant
    logger.log("Storing embeddings in Qdrant");
    const points: z.infer<typeof EmbeddingRecord>[] = embeddings.map((embedding, i) => ({
        id: crypto.randomUUID(),
        vector: embedding,
        payload: {
            projectId: job.projectId,
            sourceId: job.id,
            docId: doc.id,
            content: splits[i].pageContent,
            title: scrapeResult.metadata?.title || '',
            name: doc.name,
        },
    }));
    await qdrantClient.upsert("embeddings", {
        points,
    });

    // store scraped markdown in doc record
    logger.log("Storing scraped markdown in doc record");
    await dataSourceDocsRepository.updateByVersion(doc.id, doc.version, {
        content: scrapeResult.markdown,
        status: "ready",
    });
}

async function runProcessTextPipeline(_logger: PrefixLogger, usageTracker: UsageTracker, job: z.infer<typeof DataSource>, doc: z.infer<typeof DataSourceDoc>) {
    const logger = _logger
        .child(doc.id)
        .child(doc.name);

    if (doc.data.type !== 'text') {
        throw new Error("Invalid data source type");
    }

    // split into chunks
    logger.log("Splitting into chunks");
    const splits = await splitter.createDocuments([doc.data.content]);

    // generate embeddings
    logger.log("Generating embeddings");
    const { embeddings, usage } = await embedMany({
        model: embeddingModel,
        values: splits.map((split) => split.pageContent)
    });
    usageTracker.track({
        type: "EMBEDDING_MODEL_USAGE",
        modelName: embeddingModel.modelId,
        tokens: usage.tokens,
        context: "rag.text.embedding_usage",
    });

    // store embeddings in qdrant
    logger.log("Storing embeddings in Qdrant");
    const points: z.infer<typeof EmbeddingRecord>[] = embeddings.map((embedding, i) => ({
        id: crypto.randomUUID(),
        vector: embedding,
        payload: {
            projectId: job.projectId,
            sourceId: job.id,
            docId: doc.id,
            content: splits[i].pageContent,
            title: doc.name,
            name: doc.name,
        },
    }));
    await qdrantClient.upsert("embeddings", {
        points,
    });

    // store content in doc record
    logger.log("Storing content in doc record");
    await dataSourceDocsRepository.updateByVersion(doc.id, doc.version, {
        content: doc.data.content,
        status: "ready",
    });
}

async function runDeletionPipeline(_logger: PrefixLogger, job: z.infer<typeof DataSource>, doc: z.infer<typeof DataSourceDoc>): Promise<void> {
    const logger = _logger
        .child(doc.id)
        .child(doc.name);

    // Delete embeddings from qdrant
    logger.log("Deleting embeddings from Qdrant");
    await qdrantClient.delete("embeddings", {
        filter: {
            must: [
                {
                    key: "projectId",
                    match: {
                        value: job.projectId,
                    }
                },
                {
                    key: "sourceId",
                    match: {
                        value: job.id,
                    }
                },
                {
                    key: "docId",
                    match: {
                        value: doc.id,
                    }
                }
            ],
        },
    });

    // Delete docs from db
    logger.log("Deleting doc from db");
    await dataSourceDocsRepository.delete(doc.id);
}

// fetch next job from mongodb
(async () => {
    while (true) {
        const now = Date.now();
        let job: z.infer<typeof DataSource> | null = null;

        // first try to find a job that needs deleting
        job = await dataSourcesRepository.pollDeleteJob();

        if (job === null) {
            job = await dataSourcesRepository.pollPendingJob();
        }

        if (job === null) {
            // if no doc found, sleep for a bit and start again
            await new Promise(resolve => setTimeout(resolve, 5 * 1000));
            continue;
        }

        const logger = new PrefixLogger(`${job.id}-${job.version}`);
        logger.log(`Starting job ${job.id}. Type: ${job.data.type}. Status: ${job.status}`);
        let errors = false;

        try {
            if (job.status === "deleted") {
                // delete all embeddings for this source
                logger.log("Deleting embeddings from Qdrant");
                await qdrantClient.delete("embeddings", {
                    filter: {
                        must: [
                            { key: "projectId", match: { value: job.projectId } },
                            { key: "sourceId", match: { value: job.id } },
                        ],
                    },
                });

                // delete all docs for this source
                logger.log("Deleting docs from db");
                await dataSourceDocsRepository.deleteBySourceId(job.id);

                // delete the source record from db
                logger.log("Deleting source record from db");
                await dataSourcesRepository.delete(job.id);

                logger.log("Job deleted");
                continue;
            }

            // fetch docs that need updating
            const pendingDocs = [];
            let cursor = undefined;
            do {
                const result = await dataSourceDocsRepository.list(job.id, {
                    status: ["pending", "error"],
                }, cursor);
                pendingDocs.push(...result.items);
                cursor = result.nextCursor;
            } while (cursor);

            logger.log(`Found ${pendingDocs.length} docs to process`);

            // fetch project, user and billing data
            let billingCustomerId: string | null = null;
            if (USE_BILLING) {
                try {
                    billingCustomerId = await getCustomerIdForProject(job.projectId);
                } catch (e) {
                    logger.log("Unable to fetch billing customer id:", e);
                    throw new Error("Unable to fetch billing customer id");
                }
            }

            // for each doc
            for (const doc of pendingDocs) {
                // authorize with billing
                if (USE_BILLING && billingCustomerId) {
                    const authResponse = await authorize(billingCustomerId, {
                        type: "use_credits",
                    });

                    if ('error' in authResponse) {
                        throw new BillingError(authResponse.error || "Unknown billing error")
                    }
                }

                const usageTracker = new UsageTracker();
                try {
                    if (doc.data.type === "file_local" || doc.data.type === "file_s3") {
                        await runProcessFilePipeline(logger, usageTracker, job, doc);
                    } else if (doc.data.type === "text") {
                        await runProcessTextPipeline(logger, usageTracker, job, doc);
                    } else if (doc.data.type === "url") {
                        await runScrapePipeline(logger, usageTracker, job, doc);
                    }
                } catch (e: any) {
                    errors = true;
                    logger.log("Error processing doc:", e);
                    await dataSourceDocsRepository.updateByVersion(doc.id, doc.version, {
                        status: "error",
                        error: e.message,
                    });
                } finally {
                    // log usage in billing
                    if (USE_BILLING && billingCustomerId) {
                        await logUsage(billingCustomerId, {
                            items: usageTracker.flush(),
                        });
                    }
                }
            }

            // fetch docs that need to be deleted
            const deletedDocs = [];
            cursor = undefined;
            do {
                const result = await dataSourceDocsRepository.list(job.id, {
                    status: ["deleted"],
                }, cursor);
                deletedDocs.push(...result.items);
                cursor = result.nextCursor;
            } while (cursor);

            logger.log(`Found ${deletedDocs.length} docs to delete`);

            for (const doc of deletedDocs) {
                try {
                    await runDeletionPipeline(logger, job, doc);
                } catch (e: any) {
                    errors = true;
                    logger.log("Error deleting doc:", e);
                    await dataSourceDocsRepository.updateByVersion(doc.id, doc.version, {
                        status: "error",
                        error: e.message,
                    });
                }
            }
        } catch (e) {
            if (e instanceof BillingError) {
                logger.log("Billing error:", e.message);
                await dataSourcesRepository.release(job.id, job.version, {
                    status: "error",
                    billingError: e.message,
                });
            }
            logger.log("Error processing job; will retry:", e);
            await dataSourcesRepository.release(job.id, job.version, {
                status: "error",
            });
            continue;
        }

        // mark job as complete
        logger.log("Marking job as completed...");
        await dataSourcesRepository.release(job.id, job.version, {
            status: errors ? "error" : "ready",
            ...(errors ? { error: "There were some errors processing this job" } : {}),
        });
    }
})();