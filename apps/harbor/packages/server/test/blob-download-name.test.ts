import { describe, expect, it } from 'vitest';
import { blobDownloadName } from '@rowboat/spaces-protocol';
import { dispositionFor } from '../src/mime.js';

describe('blob download filenames shared by desktop and Harbor', () => {
  it.each([
    ['Watch the 54-second demo', 'video/mp4', 'Watch the 54-second demo.mp4'],
    ['Watch the 54-second demo', 'video/webm', 'Watch the 54-second demo.webm'],
    ['Report', 'application/pdf', 'Report.pdf'],
    ['Photo', 'image/jpeg', 'Photo.jpg'],
    ['Photo.jpeg', 'image/jpeg', 'Photo.jpeg'],
    ['DEMO.MP4', 'video/mp4', 'DEMO.MP4'],
    ['archive.tar.gz', 'application/zip', 'archive.tar.gz'],
    ['file.custom', 'text/plain', 'file.custom'],
    ['unknown', 'application/octet-stream', 'unknown'],
    ['unknown', 'application/x-custom', 'unknown'],
    ['  Notes  ', 'text/plain; charset=utf-8', 'Notes.txt'],
    ['Demo.', 'video/mp4', 'Demo.mp4'],
  ])('%s (%s) becomes %s', (name, mime, expected) => {
    expect(blobDownloadName(name, mime)).toBe(expected);
  });

  it('retains inferred extensions on long header filenames', () => {
    const header = dispositionFor('video/webm', 'a'.repeat(300));
    expect(header).toBe(`attachment; filename="${'a'.repeat(250)}.webm"`);
  });

  it('keeps unnamed responses and sanitizes labels', () => {
    expect(dispositionFor('image/png')).toBe('inline');
    expect(dispositionFor('video/mp4', '../Demo\r\n"')).toBe('attachment; filename="..-Demo.mp4"');
  });
});
