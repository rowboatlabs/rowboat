'use server';
import { ObjectId, WithId } from "mongodb";
import { dataSourceDocsCollection } from "../lib/mongodb";
import { z } from 'zod';
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { projectAuthCheck } from "./project.actions";
import { WithStringId } from "../lib/types/types";
import { DataSourceDoc } from "../lib/types/datasource_types";
import { DataSource } from "@/src/entities/models/data-source";
import { uploadsS3Client } from "../lib/uploads_s3_client";
import { IDataSourcesRepository } from "@/src/application/repositories/data-sources.repository.interface";
import { NotAuthorizedError } from "@/src/entities/errors/common";
import { container } from "@/di/container";

const dataSourcesRepository = container.resolve<IDataSourcesRepository>("dataSourcesRepository");

export async function getDataSource(projectId: string, sourceId: string): Promise<z.infer<typeof DataSource>> {
    await projectAuthCheck(projectId);
    const source = await dataSourcesRepository.fetch(sourceId);
    if (!source) {
        throw new Error('Invalid data source');
    }
    if (source.projectId !== projectId) {
        throw new NotAuthorizedError('You cannot access this datasource');
    }

    return source;
}

export async function listDataSources(projectId: string): Promise<z.infer<typeof DataSource>[]> {
    await projectAuthCheck(projectId);

    // list all sources
    const sources = [];
    let cursor = undefined;
    do {
        const result = await dataSourcesRepository.list(projectId, undefined, cursor);
        sources.push(...result.items);
        cursor = result.nextCursor;
    } while (cursor);

    return sources;
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
}): Promise<z.infer<typeof DataSource>> {
    await projectAuthCheck(projectId);

    let _status = "pending";
    // Only set status for non-file data sources
    if (status && data.type !== 'files_local' && data.type !== 'files_s3') {
        _status = status;
    }

    return await dataSourcesRepository.create({
        projectId,
        name: name,
        description: description || "",
        data,
        status: _status as z.infer<typeof DataSource>['status'],
    });
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
    await dataSourcesRepository.update(sourceId, {
        status: 'pending',
        billingError: null,
        attempts: 0,
    }, true);
}

export async function deleteDataSource(projectId: string, sourceId: string) {
    await projectAuthCheck(projectId);
    await getDataSource(projectId, sourceId);

    // mark data source as deleted
    await dataSourcesRepository.update(sourceId, {
        status: 'deleted',
        billingError: undefined,
        attempts: 0,
    }, true);
}

export async function toggleDataSource(projectId: string, sourceId: string, active: boolean) {
    await projectAuthCheck(projectId);
    await getDataSource(projectId, sourceId);

    await dataSourcesRepository.update(sourceId, {
        active,
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
        await dataSourcesRepository.update(sourceId, {
            status: "pending",
            billingError: undefined,
            attempts: 0,
        }, true);
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
    await dataSourcesRepository.update(sourceId, {
        status: 'pending',
        billingError: undefined,
        attempts: 0,
    }, true);
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

    await dataSourcesRepository.update(sourceId, {
        description,
    }, true);
}
