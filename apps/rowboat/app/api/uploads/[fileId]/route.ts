import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { dataSourceDocsCollection } from '@/app/lib/mongodb';
import { ObjectId } from 'mongodb';

const UPLOADS_DIR = process.env.RAG_UPLOADS_DIR || '/uploads';

// PUT endpoint to handle file uploads
export async function PUT(
    request: NextRequest,
    { params }: { params: { fileId: string } }
) {
    const fileId = params.fileId;
    if (!fileId) {
        return NextResponse.json({ error: 'Missing file ID' }, { status: 400 });
    }

    const filePath = path.join(UPLOADS_DIR, fileId);

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
export async function GET(
    request: NextRequest,
    { params }: { params: { fileId: string } }
) {
    const fileId = params.fileId;
    if (!fileId) {
        return NextResponse.json({ error: 'Missing file ID' }, { status: 400 });
    }

    const filePath = path.join(UPLOADS_DIR, fileId);

    // get mimetype from database
    const doc = await dataSourceDocsCollection.findOne({ _id: new ObjectId(fileId) });
    if (!doc) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    if (doc.data.type !== 'file_local') {
        return NextResponse.json({ error: 'File is not local' }, { status: 400 });
    }
    const mimeType = 'application/octet-stream';
    const fileName = doc.data.name;

    try {
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
