export interface IUploadsStorageService {
    getUploadUrl(key: string, contentType: string): Promise<string>;
    getDownloadUrl(fileId: string): Promise<string>;
    getFileContents(fileId: string): Promise<Buffer>;
}