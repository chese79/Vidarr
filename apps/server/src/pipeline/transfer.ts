import fs from 'node:fs/promises';
import path from 'node:path';

export type TransferMode = 'hardlink' | 'copy' | 'move';

// Hardlink/move can fail across filesystem/drive boundaries (EXDEV) — fall back
// to copy(+delete for move) in that case, same behavior Sonarr/Radarr's own
// "TransferMode" setting has.
export async function placeFile(
  sourcePath: string,
  destPath: string,
  mode: TransferMode,
): Promise<void> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  if (mode === 'copy') {
    await fs.copyFile(sourcePath, destPath);
    return;
  }

  if (mode === 'hardlink') {
    try {
      await fs.link(sourcePath, destPath);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      await fs.copyFile(sourcePath, destPath);
      return;
    }
  }

  // move
  try {
    await fs.rename(sourcePath, destPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    await fs.copyFile(sourcePath, destPath);
    await fs.unlink(sourcePath);
  }
}
