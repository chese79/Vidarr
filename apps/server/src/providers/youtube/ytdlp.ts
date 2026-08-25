import { spawn } from 'node:child_process';
import path from 'node:path';

// Configurable so the binary doesn't have to be on PATH — matches Sonarr/Radarr's
// own "path to external tool" settings pattern. Defaults assume PATH (true in the
// Docker image, which bundles both).
const YTDLP_PATH = process.env.YTDLP_PATH ?? 'yt-dlp';
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? 'ffmpeg';

export interface YoutubeVideoListing {
  youtubeVideoId: string;
  title: string;
}

const PROGRESS_LINE = /\[download\]\s+(\d+(?:\.\d+)?)%/;

function runYtDlp(
  args: string[],
  onProgress?: (fraction: number) => void,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_PATH, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      stdout += chunk;
      if (onProgress) {
        const match = PROGRESS_LINE.exec(chunk);
        if (match) onProgress(Number(match[1]) / 100);
      }
    });
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
  });
}

export async function listChannelVideos(sourceUrl: string): Promise<YoutubeVideoListing[]> {
  const { stdout, stderr, code } = await runYtDlp(['--flat-playlist', '--dump-json', sourceUrl]);
  if (code !== 0) {
    throw new Error(`yt-dlp listing failed: ${stderr.split('\n').slice(-5).join(' ') || code}`);
  }
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .map((entry) => ({ youtubeVideoId: String(entry.id), title: entry.title as string }));
}

export interface YoutubeSearchCandidate {
  youtubeVideoId: string;
  title: string;
  channel: string;
}

// A playlist (unlike a single artist's channel/playlist source, see
// listChannelVideos) can span many different artists/channels — bulk-import
// needs the per-video channel to guess which artist each video belongs to.
// Confirmed live: a channel's "Videos" listing doesn't populate the
// per-entry channel/uploader fields at all (only playlist_channel/
// playlist_uploader, which describe the listing itself) — a genuine curated
// playlist does populate channel/uploader per entry instead. Falling back
// through both pairs covers both shapes.
export async function listPlaylistVideos(url: string): Promise<YoutubeSearchCandidate[]> {
  const { stdout, stderr, code } = await runYtDlp(['--flat-playlist', '--dump-json', url]);
  if (code !== 0) {
    throw new Error(`yt-dlp playlist listing failed: ${stderr.split('\n').slice(-5).join(' ') || code}`);
  }
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .map((entry) => ({
      youtubeVideoId: String(entry.id),
      title: entry.title as string,
      channel: (entry.channel || entry.uploader || entry.playlist_channel || entry.playlist_uploader || '') as string,
    }));
}

const SEARCH_RESULT_COUNT = 8;

export async function searchYoutube(query: string): Promise<YoutubeSearchCandidate[]> {
  const { stdout, stderr, code } = await runYtDlp([
    '--flat-playlist',
    '--dump-json',
    `ytsearch${SEARCH_RESULT_COUNT}:${query}`,
  ]);
  if (code !== 0) {
    throw new Error(`yt-dlp search failed: ${stderr.split('\n').slice(-5).join(' ') || code}`);
  }
  return stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .map((entry) => ({
      youtubeVideoId: String(entry.id),
      title: entry.title as string,
      channel: (entry.channel || entry.uploader || '') as string,
    }));
}

const DEFAULT_FORMAT = 'bestvideo[height<=1080]+bestaudio/best';

export async function downloadVideo(
  youtubeVideoId: string,
  destDir: string,
  formatSelector: string = DEFAULT_FORMAT,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  const args = [
    '-f',
    formatSelector,
    '--merge-output-format',
    'mp4',
    '--newline', // one progress update per line — needed since stdout is piped, not a TTY
    '-P',
    destDir,
    '-o',
    '%(id)s.%(ext)s',
    '--print',
    'after_move:filepath',
  ];
  // Only override ffmpeg's location when explicitly configured — otherwise let
  // yt-dlp find it on PATH itself (the default, and how the Docker image works).
  if (FFMPEG_PATH !== 'ffmpeg') {
    args.push('--ffmpeg-location', path.dirname(FFMPEG_PATH));
  }
  args.push(url);
  const { stdout, stderr, code } = await runYtDlp(args, onProgress);
  if (code !== 0) {
    throw new Error(`yt-dlp download failed: ${stderr.split('\n').slice(-5).join(' ') || code}`);
  }
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const filepath = lines[lines.length - 1];
  if (!filepath) throw new Error('yt-dlp did not report an output file path');
  return filepath;
}
