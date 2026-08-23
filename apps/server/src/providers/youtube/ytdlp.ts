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

function runYtDlp(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_PATH, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
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

const DEFAULT_FORMAT = 'bestvideo[height<=1080]+bestaudio/best';

export async function downloadVideo(
  youtubeVideoId: string,
  destDir: string,
  formatSelector: string = DEFAULT_FORMAT,
): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
  const args = [
    '-f',
    formatSelector,
    '--merge-output-format',
    'mp4',
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
  const { stdout, stderr, code } = await runYtDlp(args);
  if (code !== 0) {
    throw new Error(`yt-dlp download failed: ${stderr.split('\n').slice(-5).join(' ') || code}`);
  }
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const filepath = lines[lines.length - 1];
  if (!filepath) throw new Error('yt-dlp did not report an output file path');
  return filepath;
}
