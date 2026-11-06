import { expect, it } from 'vitest';
import { ownsSidecar } from '../src/media/sidecarOwnership.js';
it('retains exact metadata, artwork and language variants without claiming a dotted sibling', () => {
  const names = ['Song.mp4', 'Song.Live.mp4', 'Song.en.mp4'];
  for (const name of ['Song.nfo', 'Song-thumb.jpg', 'Song.fr.forced.srt', 'Song.mtv.ass', 'Song.mtv-info.eng.ass']) expect(ownsSidecar('Song.mp4', name, names), name).toBe(true);
  for (const name of ['Song.Live.nfo', 'Song.Live.en.srt', 'Song.en.srt', 'Song.Live.jpg', 'Song-other.nfo']) expect(ownsSidecar('Song.mp4', name, names), name).toBe(false);
});
it('preserves companions shared by two media extensions with the same stem', () => {
  expect(ownsSidecar('Song.mp4', 'Song.nfo', ['Song.mp4', 'Song.mkv'])).toBe(false);
  expect(ownsSidecar('Song.mp4', 'Song.en.srt', ['Song.mp4', 'Song.mkv'])).toBe(false);
});
