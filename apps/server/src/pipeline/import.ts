import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma, logActivity } from '../db/client.js';
import { renderNamingFormat } from '@vidarr/shared-types';
import { type TransferMode } from './transfer.js';
import { stageImportBundle } from './importBundle.js';
import { isPathWithinRoot } from './pathContainment.js';
import { getLibraryConnectorProvider } from '../providers/library/index.js';
import { normalizeRootFolderPath } from './rootFolderPath.js';

export interface ImportResult {
  path: string;
  sizeBytes: bigint;
}

export class InsufficientDiskSpaceError extends Error {}

// Shared by every source (YouTube, indexer/download-client, and quality
// upgrades) — once a grab produces a file on disk, it's imported the same way.
export async function importDownloadedFile(
  musicVideoId: number,
  sourcePath: string,
  qualityName: string,
): Promise<ImportResult> {
  const musicVideo = await prisma.musicVideo.findUniqueOrThrow({
    where: { id: musicVideoId },
    include: { artist: { include: { rootFolder: { include: { targetConnector: true } } } } },
  });
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
  const existingFile = await prisma.musicVideoFile.findUnique({ where: { musicVideoId } });

  const sourceStat = await fs.lstat(sourcePath);
  if (!sourceStat.isFile()) throw new Error('The import source must be a regular video file.');
  const rootFolder = musicVideo.artist.rootFolder;
  const rootPath = normalizeRootFolderPath(rootFolder.path);
  if (rootFolder.freeSpaceBytes !== null) {
    const minFreeBytes = BigInt(settings.minFreeSpaceMb) * 1024n * 1024n;
    const remainingAfter = rootFolder.freeSpaceBytes - BigInt(sourceStat.size);
    if (remainingAfter < minFreeBytes) {
      throw new InsufficientDiskSpaceError(
        `Importing this file would leave ${rootFolder.path} below the configured minimum free space (${settings.minFreeSpaceMb} MB).`,
      );
    }
  }

  const relativePath = renderNamingFormat(settings.namingFormat, {
    artistName: musicVideo.artist.name,
    videoTitle: musicVideo.title,
    year: musicVideo.releaseYear,
    quality: qualityName,
  });
  const destPath = path.join(rootPath, `${relativePath}${path.extname(sourcePath)}`);

  if (!isPathWithinRoot(rootPath, destPath)) {
    throw new Error(
      `Refusing to import outside the configured root folder (computed path escaped ${rootPath}).`,
    );
  }

  const transferMode = settings.transferMode as TransferMode;
  const replacement = await stageImportBundle(sourcePath, destPath, transferMode, {
    artistName: musicVideo.artist.name, title: musicVideo.title,
    year: musicVideo.releaseYear, director: musicVideo.director, thumbnailUrl: musicVideo.thumbnailUrl,
  });
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(destPath);

    const quality = await prisma.quality.findUnique({ where: { name: qualityName } });

    await prisma.$transaction([prisma.musicVideoFile.upsert({
      where: { musicVideoId },
      update: {
        path: destPath,
        sizeBytes: BigInt(stat.size),
        qualityId: quality?.id,
        originalFilename: path.basename(sourcePath),
        dateAdded: new Date(),
      },
      create: {
        musicVideoId,
        path: destPath,
        sizeBytes: BigInt(stat.size),
        qualityId: quality?.id,
        originalFilename: path.basename(sourcePath),
      },
    }), prisma.musicVideo.update({
      where: { id: musicVideoId },
      data: { hasFile: true, awaitingServerScanAt: new Date() },
    }), prisma.history.create({
      data: {
        musicVideoId,
        eventType: 'downloadFolderImported',
        data: JSON.stringify({
          path: destPath,
          quality: qualityName,
          upgradedFrom: existingFile && existingFile.path !== destPath ? existingFile.path : undefined,
        }),
      },
    })]);
  } catch (error) {
    await replacement.rollback();
    throw error;
  }
  await replacement.commit();

  // A quality upgrade can change the filename. Keep the previous file until
  // the replacement is fully recorded, and never delete a path outside the
  // configured root if an older record points elsewhere.
  if (existingFile && existingFile.path !== destPath && isPathWithinRoot(rootPath, existingFile.path)) {
    await fs.unlink(existingFile.path).catch(async (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') await logActivity('warn', 'old-video-cleanup', err).catch(() => {});
    });
  }

  if (rootFolder.targetConnector?.enabled && rootFolder.targetConnector.videoLibraryId) {
    try {
      const provider = getLibraryConnectorProvider(rootFolder.targetConnector.type);
      if (provider.refreshVideoLibrary) await provider.refreshVideoLibrary(rootFolder.targetConnector);
    } catch (err) {
      await logActivity('warn', 'media-server-refresh', err);
    }
  }

  return { path: destPath, sizeBytes: BigInt(stat.size) };
}
