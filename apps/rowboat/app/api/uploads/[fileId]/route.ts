import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { container } from '@/di/container';
import { IDataSourceDocsRepository } from '@/src/application/repositories/data-source-docs.repository.interface';

const UPLOADS_DIR = process.env.RAG_UPLOADS_DIR || '/uploads';

const dataSourceDocsRepository = container.resolve<IDataSourceDocsRepository>('dataSourceDocsRepository');

/**
 * Validates that a resolved file path stays within the uploads directory.
 * Prevents path traversal attacks (e.g., fileId containing "../").
 */
function validateUploadPath(resolvedPath: string): boolean {
    const normalizedUploadsDir = path.resolve(UPLOADS_DIR);
    return resolvedPath.startsWith(normalizedUploadsDir + path.sep) || resolvedPath === normalizedUploadsDir;
}

// PUT endpoint to handle file uploads
export async function PUT(request: NextRequest, props: { params: Promise<{ fileId: string }> }) {
    const params = await props.params;
    const fileId = params.fileId;
    if (!fileId) {
        return NextResponse.json({ error: 'Missing file ID' }, { status: 400 });
    }

    const resolvedPath = path.resolve(UPLOADS_DIR, fileId);
    if (!validateUploadPath(resolvedPath)) {
        return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    try {
        const data = await request.arrayBuffer();
        await fs.writeFile(resolvedPath, new Uint8Array(data));
        
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error saving file:', error);
        return NextResponse.json(
            { error: 'Failed to save file' },
            { status: 500 }
        );
    }
}

// GET endpoint to handle file downloads
export async function GET(request: NextRequest, props: { params: Promise<{ fileId: string }> }) {
    const params = await props.params;
    const fileId = params.fileId;
    if (!fileId) {
        return NextResponse.json({ error: 'Missing file ID' }, { status: 400 });
    }

    // Validate the fileId path as well
    const resolvedIdPath = path.resolve(UPLOADS_DIR, fileId);
    if (!validateUploadPath(resolvedIdPath)) {
        return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    // get mimetype from database
    const doc = await dataSourceDocsRepository.fetch(fileId);
    if (!doc) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    if (doc.data.type !== 'file_local') {
        return NextResponse.json({ error: 'File is not local' }, { status: 400 });
    }
    const mimeType = 'application/octet-stream';
    const fileName = doc.data.name;

    try {
        // strip uploads dir from path
        const pathSegment = doc.data.path.split('/api/uploads/')[1];
        const filePath = path.resolve(UPLOADS_DIR, pathSegment);
        if (!validateUploadPath(filePath)) {
            return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
        }

        // Check if file exists
        await fs.access(filePath);
        // Create a readable stream
        const nodeStream = fsSync.createReadStream(filePath);
        // Convert Node.js stream to Web stream
        const webStream = new ReadableStream({
            start(controller) {
                nodeStream.on('data', (chunk) => controller.enqueue(chunk));
                nodeStream.on('end', () => controller.close());
                nodeStream.on('error', (err) => controller.error(err));
            }
        });
        return new NextResponse(webStream, {
            status: 200,
            headers: {
                'Content-Type': mimeType,
                'Content-Disposition': `attachment; filename="${fileName}"`,
            },
        });
    } catch (error) {
        console.error('Error reading file:', error);
        return NextResponse.json(
            { error: 'File not found' },
            { status: 404 }
        );
    }
}
