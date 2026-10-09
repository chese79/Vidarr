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
// staging operation succeeds. The caller retains the backup until recording
// succeeds, or rolls the filesystem changes back if it fails.
export async function stageFileReplacement(
  sourcePath: string,
  destPath: string,
  mode: TransferMode,
): Promise<{ commit: () => Promise<void>; rollback: () => Promise<void> }> {
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
      throw err;
    }
  } catch (err) {
    if (mode === 'move') await placeFile(stagedPath, sourcePath, 'move').catch(() => {});
    else await fs.unlink(stagedPath).catch(() => {});
    throw err;
  }
  return {
    // The caller commits only after metadata and database recording succeed.
    // Failure to remove a backup should not turn a successful import into failure.
    commit: async () => { await fs.unlink(backupPath).catch(() => {}); },
    rollback: async () => {
      // Keep the backup intact if restoring the replacement to its staging
      // source fails; never discard the last copy of the original video.
      if (mode === 'move') await placeFile(destPath, sourcePath, 'move');
      else await fs.unlink(destPath);
      await fs.rename(backupPath, destPath);
    },
  };
}

// Standalone callers have no later recording step; imports use the staged API.
export async function replaceFile(sourcePath: string, destPath: string, mode: TransferMode): Promise<void> {
  const replacement = await stageFileReplacement(sourcePath, destPath, mode);
  await replacement.commit();
}
