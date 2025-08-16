import { IUploadsStorageService } from "@/src/application/services/uploads-storage.service.interface";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class S3UploadsStorageService implements IUploadsStorageService {
    private readonly s3Client: S3Client;
    private readonly bucket: string;

    constructor() {
        this.s3Client = new S3Client({
            region: process.env.UPLOADS_AWS_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
            },
        });
        this.bucket = process.env.RAG_UPLOADS_S3_BUCKET || '';
    }

    async getUploadUrl(key: string, contentType: string): Promise<string> {
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: contentType,
        });
        return await getSignedUrl(this.s3Client, command, { expiresIn: 600 });
    }

    async getDownloadUrl(key: string): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });
        return await getSignedUrl(this.s3Client, command, { expiresIn: 60 });
    }
}