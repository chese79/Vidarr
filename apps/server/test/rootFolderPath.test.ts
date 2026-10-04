import { describe, expect, it } from 'vitest';
import { InvalidRootFolderPathError, normalizeRootFolderPath } from '../src/pipeline/rootFolderPath.js';

describe('root folder path validation', () => {
  it('accepts and normalizes an absolute container path on Linux', () => {
    expect(normalizeRootFolderPath(' /mnt/d/media/music-videos/ ', 'linux'))
      .toBe('/mnt/d/media/music-videos/');
  });

  it.each([
    'D:\\media\\music-videos',
    '\\\\server\\share\\music-videos',
    'media/music-videos',
  ])('rejects a host or relative path on Linux: %s', (rootPath) => {
    expect(() => normalizeRootFolderPath(rootPath, 'linux')).toThrow(InvalidRootFolderPathError);
  });

  it('accepts a Windows absolute path for a native Windows process', () => {
    expect(normalizeRootFolderPath('D:\\media\\music-videos', 'win32'))
      .toBe('D:\\media\\music-videos');
  });
});
