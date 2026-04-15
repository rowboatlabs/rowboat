import { asClass } from "awilix";

import { MongoDBDataSourcesRepository } from "@/src/infrastructure/repositories/mongodb.data-sources.repository";
import { MongoDBDataSourceDocsRepository } from "@/src/infrastructure/repositories/mongodb.data-source-docs.repository";
import { CreateDataSourceUseCase } from "@/src/application/use-cases/data-sources/create-data-source.use-case";
import { FetchDataSourceUseCase } from "@/src/application/use-cases/data-sources/fetch-data-source.use-case";
import { ListDataSourcesUseCase } from "@/src/application/use-cases/data-sources/list-data-sources.use-case";
import { UpdateDataSourceUseCase } from "@/src/application/use-cases/data-sources/update-data-source.use-case";
import { DeleteDataSourceUseCase } from "@/src/application/use-cases/data-sources/delete-data-source.use-case";
import { ToggleDataSourceUseCase } from "@/src/application/use-cases/data-sources/toggle-data-source.use-case";
import { AddDocsToDataSourceUseCase } from "@/src/application/use-cases/data-sources/add-docs-to-data-source.use-case";
import { ListDocsInDataSourceUseCase } from "@/src/application/use-cases/data-sources/list-docs-in-data-source.use-case";
import { DeleteDocFromDataSourceUseCase } from "@/src/application/use-cases/data-sources/delete-doc-from-data-source.use-case";
import { RecrawlWebDataSourceUseCase } from "@/src/application/use-cases/data-sources/recrawl-web-data-source.use-case";
import { GetUploadUrlsForFilesUseCase } from "@/src/application/use-cases/data-sources/get-upload-urls-for-files.use-case";
import { GetDownloadUrlForFileUseCase } from "@/src/application/use-cases/data-sources/get-download-url-for-file.use-case";
import { CreateDataSourceController } from "@/src/interface-adapters/controllers/data-sources/create-data-source.controller";
import { FetchDataSourceController } from "@/src/interface-adapters/controllers/data-sources/fetch-data-source.controller";
import { ListDataSourcesController } from "@/src/interface-adapters/controllers/data-sources/list-data-sources.controller";
import { UpdateDataSourceController } from "@/src/interface-adapters/controllers/data-sources/update-data-source.controller";
import { DeleteDataSourceController } from "@/src/interface-adapters/controllers/data-sources/delete-data-source.controller";
import { ToggleDataSourceController } from "@/src/interface-adapters/controllers/data-sources/toggle-data-source.controller";
import { AddDocsToDataSourceController } from "@/src/interface-adapters/controllers/data-sources/add-docs-to-data-source.controller";
import { ListDocsInDataSourceController } from "@/src/interface-adapters/controllers/data-sources/list-docs-in-data-source.controller";
import { DeleteDocFromDataSourceController } from "@/src/interface-adapters/controllers/data-sources/delete-doc-from-data-source.controller";
import { RecrawlWebDataSourceController } from "@/src/interface-adapters/controllers/data-sources/recrawl-web-data-source.controller";
import { GetUploadUrlsForFilesController } from "@/src/interface-adapters/controllers/data-sources/get-upload-urls-for-files.controller";
import { GetDownloadUrlForFileController } from "@/src/interface-adapters/controllers/data-sources/get-download-url-for-file.controller";

export const dataSourceRegistrations = {
    dataSourcesRepository: asClass(MongoDBDataSourcesRepository).singleton(),
    dataSourceDocsRepository: asClass(MongoDBDataSourceDocsRepository).singleton(),
    createDataSourceUseCase: asClass(CreateDataSourceUseCase).singleton(),
    fetchDataSourceUseCase: asClass(FetchDataSourceUseCase).singleton(),
    listDataSourcesUseCase: asClass(ListDataSourcesUseCase).singleton(),
    updateDataSourceUseCase: asClass(UpdateDataSourceUseCase).singleton(),
    deleteDataSourceUseCase: asClass(DeleteDataSourceUseCase).singleton(),
    toggleDataSourceUseCase: asClass(ToggleDataSourceUseCase).singleton(),
    createDataSourceController: asClass(CreateDataSourceController).singleton(),
    fetchDataSourceController: asClass(FetchDataSourceController).singleton(),
    listDataSourcesController: asClass(ListDataSourcesController).singleton(),
    updateDataSourceController: asClass(UpdateDataSourceController).singleton(),
    deleteDataSourceController: asClass(DeleteDataSourceController).singleton(),
    toggleDataSourceController: asClass(ToggleDataSourceController).singleton(),
    addDocsToDataSourceUseCase: asClass(AddDocsToDataSourceUseCase).singleton(),
    listDocsInDataSourceUseCase: asClass(ListDocsInDataSourceUseCase).singleton(),
    deleteDocFromDataSourceUseCase: asClass(DeleteDocFromDataSourceUseCase).singleton(),
    recrawlWebDataSourceUseCase: asClass(RecrawlWebDataSourceUseCase).singleton(),
    getUploadUrlsForFilesUseCase: asClass(GetUploadUrlsForFilesUseCase).singleton(),
    getDownloadUrlForFileUseCase: asClass(GetDownloadUrlForFileUseCase).singleton(),
    addDocsToDataSourceController: asClass(AddDocsToDataSourceController).singleton(),
    listDocsInDataSourceController: asClass(ListDocsInDataSourceController).singleton(),
    deleteDocFromDataSourceController: asClass(DeleteDocFromDataSourceController).singleton(),
    recrawlWebDataSourceController: asClass(RecrawlWebDataSourceController).singleton(),
    getUploadUrlsForFilesController: asClass(GetUploadUrlsForFilesController).singleton(),
    getDownloadUrlForFileController: asClass(GetDownloadUrlForFileController).singleton(),
};
