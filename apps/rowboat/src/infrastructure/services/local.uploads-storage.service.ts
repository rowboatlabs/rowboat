import { IDataSourceDocsRepository } from "@/src/application/repositories/data-source-docs.repository.interface";
import { IUploadsStorageService } from "@/src/application/services/uploads-storage.service.interface";
import fs from "fs";
import path from "path";
import { NotFoundError } from "@/src/entities/errors/common";

const UPLOADS_DIR = process.env.RAG_UPLOADS_DIR || '/uploads';

export class LocalUploadsStorageService implements IUploadsStorageService {
    private readonly dataSourceDocsRepository: IDataSourceDocsRepository;

    constructor({
        dataSourceDocsRepository,
    }: {
        dataSourceDocsRepository: IDataSourceDocsRepository,
    }) {
        this.dataSourceDocsRepository = dataSourceDocsRepository;
    }

    async getUploadUrl(key: string, contentType: string): Promise<string> {
        return `/api/uploads/${key}`;
    }

    async getDownloadUrl(fileId: string): Promise<string> {
        return `/api/uploads/${fileId}`;
    }

    async getFileContents(fileId: string): Promise<Buffer> {
        const file = await this.dataSourceDocsRepository.fetch(fileId);
        if (!file) {
            throw new NotFoundError('File not found');
        }
        if (file.data.type !== 'file_local') {
            throw new NotFoundError('File is not a local file');
        }
        const filePath = file.data.path.split('/api/uploads/')[1];
        return fs.readFileSync(path.join(UPLOADS_DIR, filePath));
    }
}