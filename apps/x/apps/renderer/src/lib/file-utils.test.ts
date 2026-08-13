import { describe, expect, it } from 'vitest'
import { isImageFilePath } from './file-utils'

describe('isImageFilePath', () => {
  it('matches each previewable image extension', () => {
    expect(isImageFilePath('photo.png')).toBe(true)
    expect(isImageFilePath('photo.jpg')).toBe(true)
    expect(isImageFilePath('photo.jpeg')).toBe(true)
    expect(isImageFilePath('photo.gif')).toBe(true)
    expect(isImageFilePath('photo.webp')).toBe(true)
    expect(isImageFilePath('diagram.svg')).toBe(true)
  })

  it('is case-insensitive on the extension', () => {
    expect(isImageFilePath('photo.PNG')).toBe(true)
    expect(isImageFilePath('photo.JpEg')).toBe(true)
    expect(isImageFilePath('photo.WEBP')).toBe(true)
  })

  it('matches absolute and nested paths, including dots in directories', () => {
    expect(isImageFilePath('/Users/me/.rowboat/generated_images/cat-123.png')).toBe(true)
    expect(isImageFilePath('some.dir/v1.2/output.webp')).toBe(true)
  })

  it('rejects non-image extensions', () => {
    expect(isImageFilePath('notes.txt')).toBe(false)
    expect(isImageFilePath('report.pdf')).toBe(false)
    expect(isImageFilePath('song.mp3')).toBe(false)
    expect(isImageFilePath('icon.bmp')).toBe(false)
    expect(isImageFilePath('favicon.ico')).toBe(false)
  })

  it('rejects paths without an extension', () => {
    expect(isImageFilePath('README')).toBe(false)
    expect(isImageFilePath('some/dir/file')).toBe(false)
    expect(isImageFilePath('')).toBe(false)
  })

  it('rejects a bare dotfile named like an extension', () => {
    expect(isImageFilePath('.png')).toBe(false)
  })

  it('does not match an image extension mid-path', () => {
    expect(isImageFilePath('archive.png.zip')).toBe(false)
    expect(isImageFilePath('shots.png/notes.txt')).toBe(false)
  })
})
