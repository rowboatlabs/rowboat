import '../lib/loadenv';
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { z } from 'zod';
import { dataSourceDocsCollection, dataSourcesCollection } from '../lib/mongodb';
import { EmbeddingRecord, DataSourceDoc, DataSource } from "../lib/types/datasource_types";
import { WithId } from 'mongodb';
import { embedMany } from 'ai';
import { embeddingModel } from '../lib/embedding';
import { qdrantClient } from '../lib/qdrant';
import { PrefixLogger } from "../lib/utils";
import crypto from 'crypto';

const splitter = new RecursiveCharacterTextSplitter({
    separators: ['\n\n', '\n', '. ', '.', ''],
    chunkSize: 1024,
    chunkOverlap: 20,
});

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;

async function runProcessPipeline(_logger: PrefixLogger, job: WithId<z.infer<typeof DataSource>>, doc: WithId<z.infer<typeof DataSourceDoc>>): Promise<void> {
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
    const { embeddings } = await embedMany({
        model: embeddingModel,
        values: splits.map((split) => split.pageContent)
    });

    // store embeddings in qdrant
    logger.log("Storing embeddings in Qdrant");
    const points: z.infer<typeof EmbeddingRecord>[] = embeddings.map((embedding, i) => ({
        id: crypto.randomUUID(),
        vector: embedding,
        payload: {
            projectId: job.projectId,
            sourceId: job._id.toString(),
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

async function runDeletionPipeline(_logger: PrefixLogger, job: WithId<z.infer<typeof DataSource>>, doc: WithId<z.infer<typeof DataSourceDoc>>): Promise<void> {
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
                        value: job._id.toString(),
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
        let job: WithId<z.infer<typeof DataSource>> | null = null;

        // first try to find a job that needs deleting
        job = await dataSourcesCollection.findOneAndUpdate({
            status: "deleted",
            "data.type": "text",
            $or: [
                { attempts: { $exists: false } },
                { attempts: { $lte: 3 } }
            ]
        }, { $set: { lastAttemptAt: new Date().toISOString() }, $inc: { attempts: 1 } }, { returnDocument: "after", sort: { createdAt: 1 } });

        if (job === null) {
            job = await dataSourcesCollection.findOneAndUpdate(
                {
                    $and: [
                        { 'data.type': { $eq: "text" } },
                        {
                            $or: [
                                // if the job has never been attempted
                                {
                                    status: "pending",
                                    attempts: 0,
                                },
                                // if the job was attempted but wasn't completed in the last hour
                                {
                                    status: "pending",
                                    lastAttemptAt: { $lt: new Date(now - 1 * hour).toISOString() },
                                },
                                // if the job errored out but hasn't been retried 3 times yet
                                {
                                    status: "error",
                                    attempts: { $lt: 3 },
                                },
                                // if the job errored out but hasn't been retried in the last 5 minutes
                                {
                                    status: "error",
                                    lastAttemptAt: { $lt: new Date(now - 1 * hour).toISOString() },
                                },
                            ]
                        }
                    ]
                },
                {
                    $set: {
                        status: "pending",
                        lastAttemptAt: new Date().toISOString(),
                    },
                    $inc: {
                        attempts: 1
                    },
                },
                { returnDocument: "after", sort: { createdAt: 1 } }
            );
        }

        if (job === null) {
            // if no doc found, sleep for a bit and start again
            await new Promise(resolve => setTimeout(resolve, 5 * second));
            continue;
        }

        const logger = new PrefixLogger(`${job._id.toString()}-${job.version}`);
        logger.log(`Starting job ${job._id}. Type: ${job.data.type}. Status: ${job.status}`);
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
                            { key: "sourceId", match: { value: job._id.toString() } },
                        ],
                    },
                });

                // delete all docs for this source
                logger.log("Deleting docs from db");
                await dataSourceDocsCollection.deleteMany({
                    sourceId: job._id.toString(),
                });

                // delete the source record from db
                logger.log("Deleting source record from db");
                await dataSourcesCollection.deleteOne({
                    _id: job._id,
                });

                logger.log("Job deleted");
                continue;
            }

            // fetch docs that need updating
            const pendingDocs = await dataSourceDocsCollection.find({
                sourceId: job._id.toString(),
                status: { $in: ["pending", "error"] },
            }).toArray();

            logger.log(`Found ${pendingDocs.length} docs to process`);

            // for each doc
            for (const doc of pendingDocs) {
                try {
                    await runProcessPipeline(logger, job, doc);
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
                }
            }

            // fetch docs that need to be deleted
            const deletedDocs = await dataSourceDocsCollection.find({
                sourceId: job._id.toString(),
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
            logger.log("Error processing job; will retry:", e);
            await dataSourcesCollection.updateOne({ _id: job._id, version: job.version }, { $set: { status: "error" } });
            continue;
        }

        // mark job as complete
        logger.log("Marking job as completed...");
        await dataSourcesCollection.updateOne({
            _id: job._id,
            version: job.version,
        }, {
            $set: {
                status: errors ? "error" : "ready",
                ...(errors ? { error: "There were some errors processing this job" } : {}),
            }
        });
    }
})();
