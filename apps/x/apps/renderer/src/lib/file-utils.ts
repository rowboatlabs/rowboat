const IMAGE_MIMES = new Set([
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
    'image/svg+xml', 'image/bmp', 'image/tiff', 'image/ico', 'image/avif',
]);

const EXTENSION_TO_MIME: Record<string, string> = {
    // Images
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/ico',
    avif: 'image/avif', tiff: 'image/tiff',
    // Text / code
    txt: 'text/plain', md: 'text/markdown', html: 'text/html', css: 'text/css',
    csv: 'text/csv', xml: 'text/xml',
    js: 'text/javascript', ts: 'text/typescript', jsx: 'text/javascript',
    tsx: 'text/typescript', json: 'application/json', yaml: 'text/yaml',
    yml: 'text/yaml', toml: 'text/toml',
    py: 'text/x-python', rb: 'text/x-ruby', rs: 'text/x-rust',
    go: 'text/x-go', java: 'text/x-java', c: 'text/x-c', cpp: 'text/x-c++',
    h: 'text/x-c', hpp: 'text/x-c++', sh: 'text/x-shellscript',
    // Documents
    pdf: 'application/pdf',
    // Archives
    zip: 'application/zip',
};

export function isImageMime(mimeType: string): boolean {
    return IMAGE_MIMES.has(mimeType) || mimeType.startsWith('image/');
}

export function getMimeFromExtension(ext: string): string {
    const normalized = ext.toLowerCase().replace(/^\./, '');
    return EXTENSION_TO_MIME[normalized] || 'application/octet-stream';
}

export function getFileDisplayName(filePath: string): string {
    return filePath.split('/').pop() || filePath;
}

export function getExtension(filePath: string): string {
    const name = filePath.split('/').pop() || '';
    const dotIndex = name.lastIndexOf('.');
    return dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
}

export function toFileUrl(filePath: string): string {
    if (!filePath) return filePath;
    if (
        filePath.startsWith('data:') ||
        filePath.startsWith('file://') ||
        filePath.startsWith('http://') ||
        filePath.startsWith('https://')
    ) {
        return filePath;
    }
    const normalized = filePath.replace(/\\/g, '/');
    const encoded = encodeURI(normalized);
    if (/^[A-Za-z]:\//.test(normalized)) {
        return `file:///${encoded}`;
    }
    return `file://${encoded}`;
}
