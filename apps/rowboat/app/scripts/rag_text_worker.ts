import '../lib/loadenv';
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { z } from 'zod';
import { dataSourceDocsCollection } from '../lib/mongodb';
import { EmbeddingRecord, DataSourceDoc } from "../lib/types/datasource_types";
import { WithId } from 'mongodb';
import { embedMany } from 'ai';
import { embeddingModel } from '../lib/embedding';
import { qdrantClient } from '../lib/qdrant';
import { PrefixLogger } from "../lib/utils";
import crypto from 'crypto';
import { USE_BILLING } from '../lib/feature_flags';
import { authorize, getCustomerIdForProject, logUsage, UsageTracker } from '../lib/billing';
import { BillingError } from '@/src/entities/errors/common';
import { DataSource } from '@/src/entities/models/data-source';
import { IDataSourcesRepository } from '@/src/application/repositories/data-sources.repository.interface';
import { container } from '@/di/container';

const dataSourcesRepository = container.resolve<IDataSourcesRepository>('dataSourcesRepository');

const splitter = new RecursiveCharacterTextSplitter({
    separators: ['\n\n', '\n', '. ', '.', ''],
    chunkSize: 1024,
    chunkOverlap: 20,
});

async function runProcessPipeline(_logger: PrefixLogger, usageTracker: UsageTracker, job: z.infer<typeof DataSource>, doc: WithId<z.infer<typeof DataSourceDoc>>) {
    const logger = _logger
        .child(doc._id.toString())
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
            docId: doc._id.toString(),
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
    await dataSourceDocsCollection.updateOne({
        _id: doc._id,
        version: doc.version,
    }, {
        $set: {
            content: doc.data.content,
            status: "ready",
            lastUpdatedAt: new Date().toISOString(),
        }
    });
}

async function runDeletionPipeline(_logger: PrefixLogger, job: z.infer<typeof DataSource>, doc: WithId<z.infer<typeof DataSourceDoc>>): Promise<void> {
    const logger = _logger
        .child(doc._id.toString())
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
                        value: doc._id.toString(),
                    }
                }
            ],
        },
    });

    // Delete docs from db
    logger.log("Deleting doc from db");
    await dataSourceDocsCollection.deleteOne({ _id: doc._id });
}

// fetch next job from mongodb
(async () => {
    while (true) {
        const now = Date.now();
        let job: z.infer<typeof DataSource> | null = null;

        // first try to find a job that needs deleting
        job = await dataSourcesRepository.pollDeleteJob(["text"]);

        if (job === null) {
            job = await dataSourcesRepository.pollPendingJob(["text"]);
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
            if (job.data.type !== 'text') {
                throw new Error("Invalid data source type");
            }

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
                await dataSourceDocsCollection.deleteMany({
                    sourceId: job.id,
                });

                // delete the source record from db
                logger.log("Deleting source record from db");
                await dataSourcesRepository.delete(job.id);

                logger.log("Job deleted");
                continue;
            }

            // fetch docs that need updating
            const pendingDocs = await dataSourceDocsCollection.find({
                sourceId: job.id,
                status: { $in: ["pending", "error"] },
            }).toArray();

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
                    await runProcessPipeline(logger, usageTracker, job, doc);
                } catch (e: any) {
                    errors = true;
                    logger.log("Error processing doc:", e);
                    await dataSourceDocsCollection.updateOne({
                        _id: doc._id,
                        version: doc.version,
                    }, {
                        $set: {
                            status: "error",
                            error: e.message,
                        }
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
            const deletedDocs = await dataSourceDocsCollection.find({
                sourceId: job.id,
                status: "deleted",
            }).toArray();

            logger.log(`Found ${deletedDocs.length} docs to delete`);

            for (const doc of deletedDocs) {
                try {
                    await runDeletionPipeline(logger, job, doc);
                } catch (e: any) {
                    errors = true;
                    logger.log("Error deleting doc:", e);
                    await dataSourceDocsCollection.updateOne({
                        _id: doc._id,
                        version: doc.version,
                    }, {
                        $set: {
                            status: "error",
                            error: e.message,
                        }
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
