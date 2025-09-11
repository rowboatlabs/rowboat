import { S3Client } from "@aws-sdk/client-s3";

export const uploadsS3Client = new S3Client({
    region: process.env.RAG_UPLOADS_S3_REGION || process.env.AWS_REGION || 'us-east-1',
    credentials: (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY)
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
        : undefined as any,
});
