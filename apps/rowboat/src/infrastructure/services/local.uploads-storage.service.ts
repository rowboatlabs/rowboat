import { IUploadsStorageService } from "@/src/application/services/uploads-storage.service.interface";

export class LocalUploadsStorageService implements IUploadsStorageService {
    async getUploadUrl(key: string, contentType: string): Promise<string> {
        return `/api/uploads/${key}`;
    }

    async getDownloadUrl(key: string): Promise<string> {
        return `/api/uploads/${key}`;
    }
}