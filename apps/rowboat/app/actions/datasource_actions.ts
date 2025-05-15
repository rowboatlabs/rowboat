'use server';
import { redirect } from "next/navigation";
import { ObjectId, WithId } from "mongodb";
import { dataSourcesCollection, dataSourceDocsCollection } from "../lib/mongodb";
import { z } from 'zod';
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { projectAuthCheck } from "./project_actions";
import { WithStringId } from "../lib/types/types";
import { DataSourceDoc } from "../lib/types/datasource_types";
import { DataSource } from "../lib/types/datasource_types";
import { uploadsS3Client } from "../lib/uploads_s3_client";
import { USE_RAG_S3_UPLOADS } from "../lib/feature_flags";

export async function getDataSource(projectId: string, sourceId: string): Promise<WithStringId<z.infer<typeof DataSource>>> {
    await projectAuthCheck(projectId);
    const source = await dataSourcesCollection.findOne({
        _id: new ObjectId(sourceId),
        projectId,
    });
    if (!source) {
        throw new Error('Invalid data source');
    }
    const { _id, ...rest } = source;
    return {
        ...rest,
        _id: _id.toString(),
    };
}

export async function listDataSources(projectId: string): Promise<WithStringId<z.infer<typeof DataSource>>[]> {
    await projectAuthCheck(projectId);
    const sources = await dataSourcesCollection.find({
        projectId: projectId,
        status: { $ne: 'deleted' },
    }).toArray();
    return sources.map((s) => ({
        ...s,
        _id: s._id.toString(),
    }));
}

export async function createDataSource({
    projectId,
    name,
    description,
    data,
    status = 'pending',
}: {
    projectId: string,
    name: string,
    description?: string,
    data: z.infer<typeof DataSource>['data'],
    status?: 'pending' | 'ready',
}): Promise<WithStringId<z.infer<typeof DataSource>>> {
    await projectAuthCheck(projectId);

    const source: z.infer<typeof DataSource> = {
        projectId: projectId,
        active: true,
        name: name,
        description,
        createdAt: (new Date()).toISOString(),
        attempts: 0,
        version: 1,
        data,
    };

    // Only set status for non-file data sources
    if (data.type !== 'files_local' && data.type !== 'files_s3') {
        source.status = status;
    }

    await dataSourcesCollection.insertOne(source);

    const { _id, ...rest } = source as WithId<z.infer<typeof DataSource>>;
    return {
        ...rest,
        _id: _id.toString(),
    };
}

export async function recrawlWebDataSource(projectId: string, sourceId: string) {
    await projectAuthCheck(projectId);

    const source = await getDataSource(projectId, sourceId);
    if (source.data.type !== 'urls') {
        throw new Error('Invalid data source type');
    }

    // mark all files as queued
    await dataSourceDocsCollection.updateMany({
        sourceId: sourceId,
    }, {
        $set: {
            status: 'pending',
            lastUpdatedAt: (new Date()).toISOString(),
            attempts: 0,
        }
    });

    // mark data source as pending
    await dataSourcesCollection.updateOne({
        _id: new ObjectId(sourceId),
    }, {
        $set: {
            status: 'pending',
            lastUpdatedAt: (new Date()).toISOString(),
            attempts: 0,
        },
        $inc: {
            version: 1,
        },
    });
}

export async function deleteDataSource(projectId: string, sourceId: string) {
    await projectAuthCheck(projectId);
    await getDataSource(projectId, sourceId);

    // mark data source as deleted
    await dataSourcesCollection.updateOne({
        _id: new ObjectId(sourceId),
    }, {
        $set: {
            status: 'deleted',
            lastUpdatedAt: (new Date()).toISOString(),
            attempts: 0,
        },
        $inc: {
            version: 1,
        },
    });

    redirect(`/projects/${projectId}/sources`);
}

export async function toggleDataSource(projectId: string, sourceId: string, active: boolean) {
    await projectAuthCheck(projectId);
    await getDataSource(projectId, sourceId);

    await dataSourcesCollection.updateOne({
        "_id": new ObjectId(sourceId),
        "projectId": projectId,
    }, {
        $set: {
            "active": active,
        }
    });
}

export async function addDocsToDataSource({
    projectId,
    sourceId,
    docData,
}: {
    projectId: string,
    sourceId: string,
    docData: {
        _id?: string,
        name: string,
        data: z.infer<typeof DataSourceDoc>['data']
    }[]
}): Promise<void> {
    await projectAuthCheck(projectId);
    const source = await getDataSource(projectId, sourceId);

    await dataSourceDocsCollection.insertMany(docData.map(doc => {
        const record: z.infer<typeof DataSourceDoc> = {
            sourceId,
            name: doc.name,
            status: 'pending',
            createdAt: new Date().toISOString(),
            data: doc.data,
            version: 1,
        };
        if (!doc._id) {
            return record;
        }
        const recordWithId = record as WithId<z.infer<typeof DataSourceDoc>>;
        recordWithId._id = new ObjectId(doc._id);
        return recordWithId;
    }));

    // Only set status to pending when files are added
    if (docData.length > 0 && (source.data.type === 'files_local' || source.data.type === 'files_s3')) {
        await dataSourcesCollection.updateOne(
            { _id: new ObjectId(sourceId) },
            {
                $set: {
                    status: 'pending',
                    attempts: 0,
                    lastUpdatedAt: new Date().toISOString(),
                },
                $inc: {
                    version: 1,
                },
            }
        );
    }
}

export async function listDocsInDataSource({
    projectId,
    sourceId,
    page = 1,
    limit = 10,
}: {
    projectId: string,
    sourceId: string,
    page?: number,
    limit?: number,
}): Promise<{
    files: WithStringId<z.infer<typeof DataSourceDoc>>[],
    total: number
}> {
    await projectAuthCheck(projectId);
    await getDataSource(projectId, sourceId);

    // Get total count
    const total = await dataSourceDocsCollection.countDocuments({
        sourceId,
        status: { $ne: 'deleted' },
    });

    // Fetch docs with pagination
    const docs = await dataSourceDocsCollection.find({
        sourceId,
        status: { $ne: 'deleted' },
    })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray();

    return {
        files: docs.map(f => ({ ...f, _id: f._id.toString() })),
        total
    };
}

export async function deleteDocsFromDataSource({
    projectId,
    sourceId,
    docIds,
}: {
    projectId: string,
    sourceId: string,
    docIds: string[],
}): Promise<void> {
    await projectAuthCheck(projectId);
    await getDataSource(projectId, sourceId);

    // mark for deletion
    await dataSourceDocsCollection.updateMany(
        {
            sourceId,
            _id: {
                $in: docIds.map(id => new ObjectId(id))
            }
        },
        {
            $set: {
                status: "deleted",
                lastUpdatedAt: new Date().toISOString(),
            },
            $inc: {
                version: 1,
            },
        }
    );

    // mark data source as pending
    await dataSourcesCollection.updateOne({
        _id: new ObjectId(sourceId),
    }, {
        $set: {
            status: 'pending',
            attempts: 0,
            lastUpdatedAt: new Date().toISOString(),
        },
        $inc: {
            version: 1,
        },
    });
}

export async function getDownloadUrlForFile(
    projectId: string,
    sourceId: string,
    fileId: string
): Promise<string> {
    await projectAuthCheck(projectId);
    await getDataSource(projectId, sourceId);
    const file = await dataSourceDocsCollection.findOne({
        sourceId,
        _id: new ObjectId(fileId),
        'data.type': { $in: ['file_local', 'file_s3'] },
    });
    if (!file) {
        throw new Error('File not found');
    }

    // if local, return path
    if (file.data.type === 'file_local') {
        return `/api/uploads/${fileId}`;
    } else if (file.data.type === 'file_s3') {
        const command = new GetObjectCommand({
            Bucket: process.env.RAG_UPLOADS_S3_BUCKET,
            Key: file.data.s3Key,
        });
        return await getSignedUrl(uploadsS3Client, command, { expiresIn: 60 }); // URL valid for 1 minute
    }

    throw new Error('Invalid file type');
}

export async function getUploadUrlsForFilesDataSource(
    projectId: string,
    sourceId: string,
    files: { name: string; type: string; size: number }[]
): Promise<{
    fileId: string,
    uploadUrl: string,
    path: string,
}[]> {
    await projectAuthCheck(projectId);
    const source = await getDataSource(projectId, sourceId);
    if (source.data.type !== 'files_local' && source.data.type !== 'files_s3') {
        throw new Error('Invalid files data source');
    }

    const urls: {
        fileId: string,
        uploadUrl: string,
        path: string,
    }[] = [];

    for (const file of files) {
        const fileId = new ObjectId().toString();

        if (source.data.type === 'files_s3') {
            // Generate presigned URL
            const projectIdPrefix = projectId.slice(0, 2); // 2 characters from the start of the projectId
            const path = `datasources/files/${projectIdPrefix}/${projectId}/${sourceId}/${fileId}/${file.name}`;
            const command = new PutObjectCommand({
                Bucket: process.env.RAG_UPLOADS_S3_BUCKET,
                Key: path,
                ContentType: file.type,
            });
            const uploadUrl = await getSignedUrl(uploadsS3Client, command, { expiresIn: 10 * 60 }); // valid for 10 minutes
            urls.push({
                fileId,
                uploadUrl,
                path,
            });
        } else if (source.data.type === 'files_local') {
            // Generate local upload URL
            urls.push({
                fileId,
                uploadUrl: '/api/uploads/' + fileId,
                path: '/api/uploads/' + fileId,
            });
        }
    }

    return urls;
}

export async function updateDataSource({
    projectId,
    sourceId,
    description,
}: {
    projectId: string,
    sourceId: string,
    description: string,
}) {
    await projectAuthCheck(projectId);
    await getDataSource(projectId, sourceId);

    await dataSourcesCollection.updateOne({
        _id: new ObjectId(sourceId),
    }, {
        $set: {
            description,
            lastUpdatedAt: (new Date()).toISOString(),
        },
        $inc: {
            version: 1,
        },
    });
}
