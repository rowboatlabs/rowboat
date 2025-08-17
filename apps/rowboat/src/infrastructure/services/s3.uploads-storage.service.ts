import { IDataSourceDocsRepository } from "@/src/application/repositories/data-source-docs.repository.interface";
import { IUploadsStorageService } from "@/src/application/services/uploads-storage.service.interface";
import { NotFoundError } from "@/src/entities/errors/common";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class S3UploadsStorageService implements IUploadsStorageService {
    private readonly s3Client: S3Client;
    private readonly bucket: string;
    private readonly dataSourceDocsRepository: IDataSourceDocsRepository;

    constructor({
        dataSourceDocsRepository,
    }: {
        dataSourceDocsRepository: IDataSourceDocsRepository,
    }) {
        this.dataSourceDocsRepository = dataSourceDocsRepository;
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

    async getDownloadUrl(fileId: string): Promise<string> {
        const file = await this.dataSourceDocsRepository.fetch(fileId);
        if (!file) {
            throw new NotFoundError('File not found');
        }
        if (file.data.type !== 'file_s3') {
            throw new NotFoundError('File is not an S3 file');
        }
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: file.data.s3Key,
        });
        return await getSignedUrl(this.s3Client, command, { expiresIn: 60 });
    }

    async getFileContents(fileId: string): Promise<Buffer> {
        const file = await this.dataSourceDocsRepository.fetch(fileId);
        if (!file) {
            throw new NotFoundError('File not found');
        }
        if (file.data.type !== 'file_s3') {
            throw new NotFoundError('File is not an S3 file');
        }
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: file.data.s3Key,
        });
        const response = await this.s3Client.send(command);
        const chunks: Uint8Array[] = [];
        for await (const chunk of response.Body as any) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }
}