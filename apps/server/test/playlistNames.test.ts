import { expect, it } from 'vitest';
import { nextPlaylistName } from '../../web/src/pages/playlistNames.js';

it('starts at one and advances past existing names without depending on list order', () => {
  expect(nextPlaylistName([])).toBe('Awesome playlist #1');
  expect(nextPlaylistName([{ name: 'Awesome playlist #2' }, { name: 'Awesome playlist #1' }, { name: 'Other' }])).toBe('Awesome playlist #3');
  expect(nextPlaylistName([{ name: 'Awesome playlist #1' }, { name: 'Awesome playlist #3' }])).toBe('Awesome playlist #2');
  expect(nextPlaylistName([{ name: ' awesome PLAYLIST #1 ' }])).toBe('Awesome playlist #2');
});
