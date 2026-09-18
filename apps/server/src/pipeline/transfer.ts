import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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

// Quality upgrades can intentionally resolve to the same destination when a
// user's naming format omits {Quality}. Hardlinking directly over that path
// fails with EEXIST, so stage the new file beside it and swap only after the
// staging operation succeeds. The backup keeps the old library file available
// for rollback if the final rename unexpectedly fails.
export async function replaceFile(
  sourcePath: string,
  destPath: string,
  mode: TransferMode,
): Promise<void> {
  const suffix = `.vidarr-${randomUUID()}`;
  const stagedPath = `${destPath}${suffix}.new`;
  const backupPath = `${destPath}${suffix}.old`;
  await placeFile(sourcePath, stagedPath, mode);

  try {
    await fs.rename(destPath, backupPath);
    try {
      await fs.rename(stagedPath, destPath);
    } catch (err) {
      await fs.rename(backupPath, destPath);
      if (mode === 'move') await fs.rename(stagedPath, sourcePath).catch(() => {});
      else await fs.unlink(stagedPath).catch(() => {});
      throw err;
    }
    // The replacement is already committed at this point. A stale backup is
    // preferable to reporting the import as failed after the new file won.
    await fs.unlink(backupPath).catch(() => {});
  } catch (err) {
    if (mode === 'move') await fs.rename(stagedPath, sourcePath).catch(() => {});
    else await fs.unlink(stagedPath).catch(() => {});
    throw err;
  }
}
