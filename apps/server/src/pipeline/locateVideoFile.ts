import fs from 'node:fs/promises';
import path from 'node:path';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv']);
const MIN_VIDEO_SIZE_BYTES = 5 * 1024 * 1024; // excludes samples/thumbnails

// A completed torrent/nzb's contentPath may be a single file or a folder
// (extras, samples, nfo, etc. alongside the real video) — pick the largest
// video file above a size floor, the same heuristic Sonarr/Radarr use.
export async function locateVideoFile(contentPath: string): Promise<string> {
  const stat = await fs.stat(contentPath);
  if (stat.isFile()) return contentPath;

  const entries = await fs.readdir(contentPath, { withFileTypes: true, recursive: true } as any);
  let best: { path: string; size: number } | null = null;

  for (const entry of entries as any[]) {
    if (!entry.isFile?.()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) continue;
    const fullPath = path.join(entry.path ?? contentPath, entry.name);
    const fileStat = await fs.stat(fullPath);
    if (fileStat.size < MIN_VIDEO_SIZE_BYTES) continue;
    if (!best || fileStat.size > best.size) best = { path: fullPath, size: fileStat.size };
  }

  if (!best) throw new Error(`No video file found in ${contentPath}`);
  return best.path;
}
