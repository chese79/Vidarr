import path from 'node:path';

export class InvalidRootFolderPathError extends Error {}

/**
 * Root folders are interpreted by the Vidarr process, not by the Docker host.
 * Requiring an absolute path for the running platform prevents path.join from
 * silently treating a Windows host path as a relative directory on Linux.
 */
export function normalizeRootFolderPath(
  input: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const value = input.trim();
  const looksLikeWindowsPath = /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);

  if (platform !== 'win32' && looksLikeWindowsPath) {
    throw new InvalidRootFolderPathError(
      'Windows host paths are not valid inside the Vidarr Docker container. Use the mounted container path, such as /media or /mnt/d/media.',
    );
  }

  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(value)) {
    throw new InvalidRootFolderPathError(
      'Root folder must be an absolute path visible to the Vidarr process. In Docker, use the container path such as /media.',
    );
  }

  return pathApi.normalize(value);
}
