import { describe, expect, it } from 'vitest';
import {
  draftToFilters,
  emptyRuleDraft,
  filtersToDraft,
  hasActiveFilter,
  parseStoredRules,
} from '../src/pages/playlistRules';
import type { PlaylistFilters } from '@vidarr/shared-types';

describe('playlist rule drafts', () => {
  const full: PlaylistFilters = {
    yearMin: 1990,
    yearMax: 1999,
    genre: 'rock',
    director: 'Someone',
    ownership: 'both',
    qualityIds: [2, 3],
    addedAfter: '2025-03-04T00:00:00.000Z',
    minPlayCount: 5,
    artistIds: [10],
    musicVideoIds: [7, 8],
  };

  it('round-trips every filter through the edit form unchanged', () => {
    // Editing a smart playlist loads its stored rules into the form and sends
    // them back; a lossy conversion would silently rewrite the user's rules.
    expect(draftToFilters(filtersToDraft(full, 'all'))).toEqual(full);
  });

  it('keeps the match mode', () => {
    expect(filtersToDraft(full, 'any').matchMode).toBe('any');
    expect(parseStoredRules(JSON.stringify(full), 'any').matchMode).toBe('any');
  });

  it('sends only filters whose toggle is on and that have a value', () => {
    const draft = { ...emptyRuleDraft(), enableYear: false, yearMin: '1990', genre: 'rock', enableGenre: false, director: '  ' };
    expect(draftToFilters(draft)).toEqual({});
  });

  it('judges "has a filter" by what would actually be sent, not by ticked boxes', () => {
    // A ticked "Year range" with both boxes blank sends nothing, so it must not
    // count — otherwise the form would allow saving a rule set that matches nothing.
    expect(hasActiveFilter({ ...emptyRuleDraft(), enableYear: true })).toBe(false);
    expect(hasActiveFilter({ ...emptyRuleDraft(), enableYear: true, yearMin: '2000' })).toBe(true);
    expect(hasActiveFilter({ ...emptyRuleDraft(), ownership: 'local' })).toBe(true);
    expect(hasActiveFilter(emptyRuleDraft())).toBe(false);
  });

  it('falls back to an empty draft for missing or malformed stored rules', () => {
    expect(parseStoredRules(null, null)).toEqual(emptyRuleDraft('all'));
    expect(parseStoredRules('{not json', 'any')).toEqual(emptyRuleDraft('any'));
  });

  it('shows the stored date in the date input and round-trips it to the same instant', () => {
    const draft = filtersToDraft({ addedAfter: '2025-03-04T00:00:00.000Z' }, 'all');
    expect(draft.addedAfter).toBe('2025-03-04');
    expect(draftToFilters(draft).addedAfter).toBe('2025-03-04T00:00:00.000Z');
  });
});
