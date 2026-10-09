import { describe, it, expect } from 'vitest';
import { cleanVideoTitle, fileStem, isPlausibleArtistName, observedArtistName, videoIdentities } from '../src/pipeline/videoIdentity.js';
import { matchLibraryVideoIdentities } from '../src/pipeline/reconciliation.js';
import { normalizeTitle } from '../src/pipeline/normalize.js';

const known = (...names: string[]) => new Set(names.map((n) => normalizeTitle(n)));
const WIN = 'D:\\media\\libraries\\music videos\\';

describe('fileStem', () => {
  it('reads the base name of a Windows or POSIX path and drops the video extension', () => {
    expect(fileStem(`${WIN}Deftones - 7 Words.mp4`)).toBe('Deftones - 7 Words');
    expect(fileStem('/media/music videos/Blur - Beetlebum.MKV')).toBe('Blur - Beetlebum');
    expect(fileStem(null)).toBe('');
    expect(fileStem(undefined)).toBe('');
  });

  it('does not strip an extension that is not a video one', () => {
    expect(fileStem('/x/Artist - Title.v2')).toBe('Artist - Title.v2');
  });
});

describe('cleanVideoTitle', () => {
  it('removes tags that describe the upload, not the song', () => {
    expect(cleanVideoTitle('Lips Like Sugar (Official Music Video)')).toBe('Lips Like Sugar');
    expect(cleanVideoTitle('The Last To Say (Official Video)')).toBe('The Last To Say');
    expect(cleanVideoTitle('Horror Head (HQ Sound)')).toBe('Horror Head');
    expect(cleanVideoTitle('"Gay Bar" (Hi Res)')).toBe('Gay Bar');
    expect(cleanVideoTitle('Madame Van Damme (2010)')).toBe('Madame Van Damme');
    expect(cleanVideoTitle('Sisters [Official Video]')).toBe('Sisters');
    expect(cleanVideoTitle('Sisters (Official Uncensored Version)')).toBe('Sisters');
    expect(cleanVideoTitle('Can You Feel It_ FINAL VERSION')).toBe('Can You Feel It FINAL VERSION');
  });

  it('keeps labels that make a different video', () => {
    expect(cleanVideoTitle('Beetlebum (Mario Caldato Jr. mix)')).toBe('Beetlebum (Mario Caldato Jr. mix)');
    expect(cleanVideoTitle('Over Now (MTV Unplugged)')).toBe('Over Now (MTV Unplugged)');
    expect(cleanVideoTitle("Richard's Hairpiece (Aphex Twin remix)")).toBe("Richard's Hairpiece (Aphex Twin remix)");
  });
});

describe('isPlausibleArtistName', () => {
  it('rejects fragments that are not artists', () => {
    for (const bad of ['', '   ', '(HD) Wilco w_ Yo La Tengo', '[Official]', '09', 'x'.repeat(81)]) expect(isPlausibleArtistName(bad), bad).toBe(false);
    for (const good of ['Deftones', '!!!', 'Florence + the Machine', 'Jay-Z', 'The 1975']) expect(isPlausibleArtistName(good), good).toBe(true);
  });
});

describe('videoIdentities', () => {
  it('preserves bracketed live and remix labels from filenames', () => {
    for (const label of ['Live', 'Aphex Twin remix']) {
      const identity = videoIdentities({ title: 'x', artistName: 'Unknown Artist', path: `/m/Blur - Beetlebum [${label}].mp4` }, known('Blur'))[0];
      expect(identity.title).toBe(`Beetlebum [${label}]`);
    }
  });
  it('takes the real artist and title from the file name, not the uploader', () => {
    const [first] = videoIdentities({ title: 'deftones - 7 Words', artistName: 'SuperDeftoner', path: `${WIN}Deftones - 7 Words.mp4` }, known());
    expect(first).toEqual({ artistName: 'Deftones', title: '7 Words', source: 'filename' });
  });

  it('prefers a split whose artist is already known, including one whose name contains a dash', () => {
    const ids = videoIdentities({ title: 'x', artistName: 'Unknown Artist', path: `${WIN}Florence - The Machine - Dog Days Are Over.mp4` }, known('Florence - The Machine'));
    expect(ids[0]).toMatchObject({ artistName: 'Florence - The Machine', title: 'Dog Days Are Over' });
    // Unknown artist: falls back to the first dash.
    const unknown = videoIdentities({ title: 'x', artistName: 'Unknown Artist', path: `${WIN}Bauhaus - Bela Lugosi's Dead - The Hunger.mp4` }, known());
    expect(unknown[0]).toMatchObject({ artistName: 'Bauhaus', title: "Bela Lugosi's Dead - The Hunger" });
  });

  it('handles "Title - Artist" when only the right-hand side is a known artist', () => {
    const ids = videoIdentities({ title: 'x', artistName: 'Unknown Artist', path: `${WIN}Heaven Beside You - Alice in Chains.mp4` }, known('Alice in Chains'));
    expect(ids[0]).toMatchObject({ artistName: 'Alice in Chains', title: 'Heaven Beside You' });
  });

  it('ignores a trailing year or tag block in the file name', () => {
    const ids = videoIdentities({ title: 'x', artistName: 'u', path: `${WIN}Lightspeed Champion - Madame Van Damme (2010).mp4` }, known());
    expect(ids[0]).toMatchObject({ artistName: 'Lightspeed Champion', title: 'Madame Van Damme' });
  });

  it("also offers the server's own title as a second candidate when it disagrees with the file name", () => {
    const ids = videoIdentities(
      { title: 'Beck - Devils Haircut', artistName: 'BeckVEVO', path: `${WIN}Beck - Richard’s Hairpiece (Aphex Twin remix of “Devil’s Haircut”).mp4` },
      known('Beck'),
    );
    expect(ids.map((i) => [i.source, i.artistName, i.title])).toEqual([
      ['filename', 'Beck', 'Richard’s Hairpiece (Aphex Twin remix of “Devil’s Haircut”)'],
      ['title', 'Beck', 'Devils Haircut'],
      ['metadata', 'Beck', 'Beck - Devils Haircut'],
    ]);
  });

  it('understands "Title" by Artist and "Artist: Title" in the server title', () => {
    expect(videoIdentities({ title: '"Submerge" by COME', artistName: 'chunkletguy' }, known())[0])
      .toMatchObject({ artistName: 'COME', title: 'Submerge', source: 'title' });
    expect(videoIdentities({ title: 'Cousteau: Talking to Myself', artistName: 'PALM Pictures' }, known('Cousteau'))[0])
      .toMatchObject({ artistName: 'Cousteau', title: 'Talking to Myself' });
    // A colon with an unknown left side is not guessed at.
    expect(videoIdentities({ title: 'Mixtape: Side A', artistName: 'someone' }, known()).map((i) => i.source)).toEqual(['metadata']);
  });

  it('falls back to the server metadata when nothing can be parsed, and never returns empties or duplicates', () => {
    const ids = videoIdentities({ title: '360\'s Garden of Departure', artistName: 'Unknown Artist', path: `${WIN}360's Garden of Departure.mp4` }, known());
    expect(ids).toEqual([{ artistName: 'Unknown Artist', title: "360's Garden of Departure", source: 'metadata' }]);
    expect(videoIdentities({ title: '', artistName: '', path: '' }, known())).toEqual([]);
  });
});

describe('observedArtistName', () => {
  const pick = (v: { title: string; artistName: string; path?: string }, k = known()) => observedArtistName(videoIdentities(v, k));

  it('records the parsed artist, never the uploader channel, when the file name or title can be parsed', () => {
    expect(pick({ title: 'x', artistName: 'chunkletguy', path: `${WIN}Come - Submerge.mp4` })).toBe('Come');
    expect(pick({ title: 'x', artistName: 'Domino Recording Co.', path: `${WIN}Lightspeed Champion - Madame Van Damme (2010).mp4` })).toBe('Lightspeed Champion');
    expect(pick({ title: '"Submerge" by COME', artistName: 'chunkletguy' })).toBe('COME');
  });

  it('falls back to the server artist only when nothing could be parsed, and never for "Unknown Artist"', () => {
    expect(pick({ title: 'Some Title', artistName: 'Real Artist' })).toBe('Real Artist');
    expect(pick({ title: 'Some Title', artistName: 'BeckVEVO' })).toBe('Beck');
    expect(pick({ title: 'Some Title', artistName: 'Unknown Artist' })).toBeNull();
  });

  it('skips parsed names that are fragments rather than recording them', () => {
    expect(pick({ title: 'x', artistName: 'Unknown Artist', path: `${WIN}(HD) Wilco w_ Yo La Tengo- Spiders - Jam.mp4` })).toBeNull();
    expect(pick({ title: 'x', artistName: 'Unknown Artist', path: `${WIN}09 - Underneath The Sycamore.mp4` })).toBeNull();
  });
});

describe('matchLibraryVideoIdentities', () => {
  const canonical = [
    { id: 1, normalizedArtistName: 'beck', normalizedTitle: 'devils haircut', releaseYear: 1996, durationSeconds: null },
    { id: 2, normalizedArtistName: 'deftones', normalizedTitle: '7 words', releaseYear: 1998, durationSeconds: null },
  ];
  const cand = (artist: string, title: string) => ({ normalizedArtistName: normalizeTitle(artist), normalizedTitle: normalizeTitle(title), releaseYear: null, durationSeconds: null });

  it('an exact match from any identity wins over a fuzzy one from an earlier identity', () => {
    // The first identity alone is only a fuzzy (probable) match for video 1.
    expect(matchLibraryVideoIdentities([cand('Beck', 'Devils Haircut Aphex Twin')], canonical, null, null))
      .toEqual({ musicVideoId: 1, matchConfidence: 'probable' });
    const result = matchLibraryVideoIdentities([cand('Beck', 'Devils Haircut Aphex Twin'), cand('Beck', 'Devils Haircut')], canonical, null, null);
    expect(result).toEqual({ musicVideoId: 1, matchConfidence: null });
  });

  it('prefers a probable match over an ambiguous one', () => {
    const result = matchLibraryVideoIdentities([cand('Deftones', '7 completely different words here'), cand('Deftones', '7 words live')], canonical, null, null);
    expect(result.musicVideoId).toBe(2);
    expect(result.matchConfidence).toBe('probable');
  });

  it('keeps an earlier match only when no identity found anything', () => {
    expect(matchLibraryVideoIdentities([cand('Nobody', 'Nothing')], canonical, { musicVideoId: 2, matchConfidence: null }, null))
      .toEqual({ musicVideoId: 2, matchConfidence: null });
    // ...but a found match replaces it.
    expect(matchLibraryVideoIdentities([cand('Beck', 'Devils Haircut')], canonical, { musicVideoId: 2, matchConfidence: null }, null))
      .toEqual({ musicVideoId: 1, matchConfidence: null });
  });

  it('never returns a video the user has rejected', () => {
    expect(matchLibraryVideoIdentities([cand('Beck', 'Devils Haircut')], canonical, null, 1).musicVideoId).not.toBe(1);
  });

  it('reports no match when nothing fits', () => {
    expect(matchLibraryVideoIdentities([cand('Nobody', 'Nothing')], canonical, null, null)).toEqual({ musicVideoId: null, matchConfidence: null });
  });
  it('handles an empty identity list without losing an existing match or restoring a rejection', () => {
    expect(matchLibraryVideoIdentities([], canonical, null, null)).toEqual({ musicVideoId: null, matchConfidence: null });
    expect(matchLibraryVideoIdentities([], canonical, { musicVideoId: 2, matchConfidence: null }, null)).toEqual({ musicVideoId: 2, matchConfidence: null });
    expect(matchLibraryVideoIdentities([], canonical, { musicVideoId: 2, matchConfidence: null }, 2)).toEqual({ musicVideoId: null, matchConfidence: null });
  });
});
