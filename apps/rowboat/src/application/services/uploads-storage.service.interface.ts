export interface IUploadsStorageService {
    getUploadUrl(key: string, contentType: string): Promise<string>;
    getDownloadUrl(key: string): Promise<string>;
}