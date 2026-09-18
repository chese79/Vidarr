import fs from 'node:fs/promises';
import type { ObjectEncodingOptions } from 'node:fs';
import path from 'node:path';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv']);
const MIN_VIDEO_SIZE_BYTES = 5 * 1024 * 1024; // excludes samples/thumbnails

// @types/node@20's fs.readdir overloads don't cover withFileTypes+recursive
// together even though Node itself has supported it since 20.1 — a types-lag
// gap, not a real `any`. `parentPath` is the current Dirent field name
// (`path` is its deprecated alias, kept here for older Node releases
// releases that predate the rename).
interface RecursiveDirent {
  name: string;
  path?: string;
  parentPath?: string;
  isFile(): boolean;
}

// A completed torrent/nzb's contentPath may be a single file or a folder
// (extras, samples, nfo, etc. alongside the real video) — pick the largest
// video file above a size floor, the same heuristic Sonarr/Radarr use.
export async function locateVideoFile(contentPath: string): Promise<string> {
  const stat = await fs.stat(contentPath);
  if (stat.isFile()) return contentPath;

  const entries = (await fs.readdir(contentPath, {
    withFileTypes: true,
    recursive: true,
  } as ObjectEncodingOptions & { withFileTypes: true })) as unknown as RecursiveDirent[];
  let best: { path: string; size: number } | null = null;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) continue;
    const fullPath = path.join(entry.parentPath ?? entry.path ?? contentPath, entry.name);
    const fileStat = await fs.stat(fullPath);
    if (fileStat.size < MIN_VIDEO_SIZE_BYTES) continue;
    if (!best || fileStat.size > best.size) best = { path: fullPath, size: fileStat.size };
  }

  if (!best) throw new Error(`No video file found in ${contentPath}`);
  return best.path;
}
