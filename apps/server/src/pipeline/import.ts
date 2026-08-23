import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db/client.js';
import { renderNamingFormat } from './naming.js';
import { placeFile, type TransferMode } from './transfer.js';

export interface ImportResult {
  path: string;
  sizeBytes: bigint;
}

// Shared by every source (YouTube today; indexer/download-client grabs later) —
// once a source's grab produces a file on disk, it's imported the same way.
export async function importDownloadedFile(
  musicVideoId: number,
  sourcePath: string,
  qualityName: string,
): Promise<ImportResult> {
  const musicVideo = await prisma.musicVideo.findUniqueOrThrow({
    where: { id: musicVideoId },
    include: { artist: { include: { rootFolder: true } } },
  });
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: 1 } });

  const relativePath = renderNamingFormat(settings.namingFormat, {
    artistName: musicVideo.artist.name,
    videoTitle: musicVideo.title,
    year: musicVideo.releaseYear,
    quality: qualityName,
  });
  const destPath = path.join(
    musicVideo.artist.rootFolder.path,
    `${relativePath}${path.extname(sourcePath)}`,
  );

  await placeFile(sourcePath, destPath, settings.transferMode as TransferMode);
  const stat = await fs.stat(destPath);

  const quality = await prisma.quality.findUnique({ where: { name: qualityName } });

  await prisma.musicVideoFile.upsert({
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
  });
  await prisma.musicVideo.update({ where: { id: musicVideoId }, data: { hasFile: true } });
  await prisma.history.create({
    data: {
      musicVideoId,
      eventType: 'downloadFolderImported',
      data: JSON.stringify({ path: destPath, quality: qualityName }),
    },
  });

  return { path: destPath, sizeBytes: BigInt(stat.size) };
}
