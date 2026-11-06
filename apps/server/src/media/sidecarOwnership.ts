import path from 'node:path';
import fs from 'node:fs/promises';

const VIDEO = /\.(mp4|mkv|webm|avi|mov|m4v|mpg|mpeg|ts|m2ts|wmv|flv)$/i;
const SUBTITLE = /^(?:(?:\.[a-z]{2,3}(?:-[a-z]{2,4})?)?(?:\.(?:forced|default|sdh|cc|mtv))*\.(?:srt|vtt|ass|ssa|sub|idx)|\.mtv-info\.[a-z]{2,3}\.ass)$/i;

// Metadata/artwork require an exact stem. Subtitle variants may add language
// and disposition, but a longer sibling video stem always owns its companions.
export function ownsSidecar(videoName: string, companionName: string, directoryNames: string[]): boolean {
  const stem = path.basename(videoName, path.extname(videoName));
  if (!companionName.startsWith(stem)) return false;
  const suffix = companionName.slice(stem.length);
  if (!(/^(?:\.(?:nfo|json|xml|jpg|jpeg|png|webp|txt)|-(?:thumb|poster|fanart|banner|clearart|landscape)\.(?:jpg|jpeg|png|webp))$/i.test(suffix) || SUBTITLE.test(suffix))) return false;
  return !directoryNames.some(name => {
    if (!VIDEO.test(name)) return false;
    const other = path.basename(name, path.extname(name));
    if (other === stem && name !== videoName) return true;
    return other.length > stem.length && companionName.startsWith(other)
      && /^[.-]/.test(companionName.slice(other.length));
  });
}

// Persisted deletion plans may predate the ownership rule. Revalidate existing
// files before remote deletion; a retry may already have removed some targets.
export async function assertOwnedSidecars(videoPaths: string[], files: string[]): Promise<void> {
  for (const file of files) {
    if (videoPaths.some(video => path.resolve(video) === path.resolve(file))) continue;
    try { await fs.lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const names = await fs.readdir(path.dirname(file));
    if (!videoPaths.some(video => path.resolve(path.dirname(video)) === path.resolve(path.dirname(file))
      && ownsSidecar(path.basename(video), path.basename(file), names))) {
      throw new Error('Sidecar ownership changed or is ambiguous; review the deletion targets before retrying.');
    }
  }
}
