import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function windows(duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('A positive probed duration is required');
  const end = Math.floor(duration * 100);
  if (!end) throw new Error('Video is shorter than one centisecond');
  return end <= 1200 ? [[0, end]] : [[0, 600], [end - 600, end]];
}
export function time(cs) {
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2,'0')}:${String(Math.floor(cs / 100) % 60).padStart(2,'0')}.${String(cs % 100).padStart(2,'0')}`;
}
// Literal text only: neutralize ASS override/drawing escapes from provider metadata.
export function literal(value) {
  return String(value ?? '').normalize('NFC').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\\/g,'＼').replace(/\{/g,'｛').replace(/\}/g,'｝').replace(/\s+/g,' ').trim().slice(0,180);
}
export function lines(meta) {
  const people = Array.isArray(meta.People) ? meta.People.filter(p=>p.Type==='Director').map(p=>p.Name).join(', ') : '';
  // ProductionYear is the Jellyfin item's year. Never substitute album publication dates.
  const year = meta.videoYear ?? meta.ProductionYear;
  return [literal(meta.artist ?? meta.Artists?.join(', ')), literal(meta.title ?? meta.Name),
    literal(meta.album ?? meta.Album), /^\d{4}$/.test(String(year)) ? String(year) : '',
    literal(meta.director ?? people) ? `Director: ${literal(meta.director ?? people)}` : '', 'MTV'].filter(Boolean);
}
export function generate(meta, duration) {
  const text = lines(meta).join('\\N');
  return `[Script Info]\nTitle: MTV Overlay Proof of Concept\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: MTV,Arial,28,&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,1,64,64,54,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` + windows(duration).map(([start,end])=>`Dialogue: 0,${time(start)},${time(end)},MTV,,0,0,0,,${text}\n`).join('');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [metadata, duration, output] = process.argv.slice(2);
  if (!metadata || !duration || !output) throw new Error('Usage: node overlay.mjs metadata.json duration-seconds output.ass');
  // Exclusive creation prevents overwriting existing subtitle files.
  await writeFile(output, generate(JSON.parse(await readFile(metadata,'utf8')), Number(duration)), {flag:'wx'});
}
