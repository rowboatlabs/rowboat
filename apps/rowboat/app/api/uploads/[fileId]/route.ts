import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { container } from '@/di/container';
import { IDataSourceDocsRepository } from '@/src/application/repositories/data-source-docs.repository.interface';

const UPLOADS_DIR = process.env.RAG_UPLOADS_DIR || '/uploads';

const dataSourceDocsRepository = container.resolve<IDataSourceDocsRepository>('dataSourceDocsRepository');

/**
 * Resolve a user-supplied file identifier to an absolute path constrained to
 * UPLOADS_DIR. Returns null if the resulting path would escape the uploads
 * directory (e.g. via `..` traversal or an absolute path).
 */
function resolveUploadPath(fileId: string): string | null {
    // Reject path separators and NUL bytes outright — fileIds are meant to be
    // opaque single-segment identifiers.
    if (!fileId || fileId.includes('\0') || fileId.includes('/') || fileId.includes('\\')) {
        return null;
    }
    const uploadsRoot = path.resolve(UPLOADS_DIR);
    const resolved = path.resolve(uploadsRoot, fileId);
    // Ensure the resolved path is strictly contained within uploadsRoot.
    if (resolved !== uploadsRoot && !resolved.startsWith(uploadsRoot + path.sep)) {
        return null;
    }
    return resolved;
}

// PUT endpoint to handle file uploads
export async function PUT(request: NextRequest, props: { params: Promise<{ fileId: string }> }) {
    const params = await props.params;
    const fileId = params.fileId;
    if (!fileId) {
        return NextResponse.json({ error: 'Missing file ID' }, { status: 400 });
    }

    const filePath = resolveUploadPath(fileId);
    if (!filePath) {
        return NextResponse.json({ error: 'Invalid file ID' }, { status: 400 });
    }

    try {
        const data = await request.arrayBuffer();
        await fs.writeFile(filePath, new Uint8Array(data));
        
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
        // strip uploads dir from path and validate containment
        const rawSegment = doc.data.path.split('/api/uploads/')[1];
        const filePath = rawSegment ? resolveUploadPath(rawSegment) : null;
        if (!filePath) {
            return NextResponse.json({ error: 'File not found' }, { status: 404 });
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
