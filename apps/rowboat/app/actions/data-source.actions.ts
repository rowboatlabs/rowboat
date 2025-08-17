'use server';
import { z } from 'zod';
import { DataSourceDoc } from "@/src/entities/models/data-source-doc";
import { DataSource } from "@/src/entities/models/data-source";
import { container } from "@/di/container";
import { IFetchDataSourceController } from "@/src/interface-adapters/controllers/data-sources/fetch-data-source.controller";
import { authCheck } from "./auth.actions";
import { IListDataSourcesController } from "@/src/interface-adapters/controllers/data-sources/list-data-sources.controller";
import { ICreateDataSourceController } from "@/src/interface-adapters/controllers/data-sources/create-data-source.controller";
import { IRecrawlWebDataSourceController } from "@/src/interface-adapters/controllers/data-sources/recrawl-web-data-source.controller";
import { IDeleteDataSourceController } from "@/src/interface-adapters/controllers/data-sources/delete-data-source.controller";
import { IToggleDataSourceController } from "@/src/interface-adapters/controllers/data-sources/toggle-data-source.controller";
import { IAddDocsToDataSourceController } from "@/src/interface-adapters/controllers/data-sources/add-docs-to-data-source.controller";
import { IListDocsInDataSourceController } from "@/src/interface-adapters/controllers/data-sources/list-docs-in-data-source.controller";
import { IDeleteDocFromDataSourceController } from "@/src/interface-adapters/controllers/data-sources/delete-doc-from-data-source.controller";
import { IGetDownloadUrlForFileController } from "@/src/interface-adapters/controllers/data-sources/get-download-url-for-file.controller";
import { IGetUploadUrlsForFilesController } from "@/src/interface-adapters/controllers/data-sources/get-upload-urls-for-files.controller";
import { IUpdateDataSourceController } from "@/src/interface-adapters/controllers/data-sources/update-data-source.controller";

const fetchDataSourceController = container.resolve<IFetchDataSourceController>("fetchDataSourceController");
const listDataSourcesController = container.resolve<IListDataSourcesController>("listDataSourcesController");
const createDataSourceController = container.resolve<ICreateDataSourceController>("createDataSourceController");
const recrawlWebDataSourceController = container.resolve<IRecrawlWebDataSourceController>("recrawlWebDataSourceController");
const deleteDataSourceController = container.resolve<IDeleteDataSourceController>("deleteDataSourceController");
const toggleDataSourceController = container.resolve<IToggleDataSourceController>("toggleDataSourceController");
const addDocsToDataSourceController = container.resolve<IAddDocsToDataSourceController>("addDocsToDataSourceController");
const listDocsInDataSourceController = container.resolve<IListDocsInDataSourceController>("listDocsInDataSourceController");
const deleteDocFromDataSourceController = container.resolve<IDeleteDocFromDataSourceController>("deleteDocFromDataSourceController");
const getDownloadUrlForFileController = container.resolve<IGetDownloadUrlForFileController>("getDownloadUrlForFileController");
const getUploadUrlsForFilesController = container.resolve<IGetUploadUrlsForFilesController>("getUploadUrlsForFilesController");
const updateDataSourceController = container.resolve<IUpdateDataSourceController>("updateDataSourceController");

export async function getDataSource(sourceId: string): Promise<z.infer<typeof DataSource>> {
    const user = await authCheck();

    return await fetchDataSourceController.execute({
        caller: 'user',
        userId: user._id,
        sourceId,
    });
}

export async function listDataSources(projectId: string): Promise<z.infer<typeof DataSource>[]> {
    const user = await authCheck();

    return await listDataSourcesController.execute({
        caller: 'user',
        userId: user._id,
        projectId,
    });
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
    const user = await authCheck();
    return await createDataSourceController.execute({
        caller: 'user',
        userId: user._id,
        data: {
            projectId,
            name,
            description: description || '',
            status,
            data,
        },
    });
}

export async function recrawlWebDataSource(sourceId: string) {
    const user = await authCheck();

    return await recrawlWebDataSourceController.execute({
        caller: 'user',
        userId: user._id,
        sourceId,
    });
}

export async function deleteDataSource(sourceId: string) {
    const user = await authCheck();

    return await deleteDataSourceController.execute({
        caller: 'user',
        userId: user._id,
        sourceId,
    });
}

export async function toggleDataSource(sourceId: string, active: boolean) {
    const user = await authCheck();

    return await toggleDataSourceController.execute({
        caller: 'user',
        userId: user._id,
        sourceId,
        active,
    });
}

export async function addDocsToDataSource({
    sourceId,
    docData,
}: {
    sourceId: string,
    docData: {
        name: string,
        data: z.infer<typeof DataSourceDoc>['data']
    }[]
}): Promise<void> {
    const user = await authCheck();

    return await addDocsToDataSourceController.execute({
        caller: 'user',
        userId: user._id,
        sourceId,
        docs: docData,
    });
}

export async function listDocsInDataSource({
    sourceId,
    page = 1,
    limit = 10,
}: {
    sourceId: string,
    page?: number,
    limit?: number,
}): Promise<{
    files: z.infer<typeof DataSourceDoc>[],
    total: number
}> {
    const user = await authCheck();

    const docs = await listDocsInDataSourceController.execute({
        caller: 'user',
        userId: user._id,
        sourceId,
    });

    return {
        files: docs,
        total: docs.length,
    };
}

export async function deleteDocFromDataSource({
    docId,
}: {
    docId: string,
}): Promise<void> {
    const user = await authCheck();
    return await deleteDocFromDataSourceController.execute({
        caller: 'user',
        userId: user._id,
        docId,
    });
}

export async function getDownloadUrlForFile(
    fileId: string
): Promise<string> {
    const user = await authCheck();

    return await getDownloadUrlForFileController.execute({
        caller: 'user',
        userId: user._id,
        fileId,
    });
}

export async function getUploadUrlsForFilesDataSource(
    sourceId: string,
    files: { name: string; type: string; size: number }[]
): Promise<{
    fileId: string,
    uploadUrl: string,
    path: string,
}[]> {
    const user = await authCheck();

    return await getUploadUrlsForFilesController.execute({
        caller: 'user',
        userId: user._id,
        sourceId,
        files,
    });
}

export async function updateDataSource({
    sourceId,
    description,
}: {
    sourceId: string,
    description: string,
}) {
    const user = await authCheck();

    return await updateDataSourceController.execute({
        caller: 'user',
        userId: user._id,
        sourceId,
        data: {
            description,
        },
    });
}
