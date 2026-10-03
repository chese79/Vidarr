import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { MatchMode, PlaylistFilters } from '@vidarr/shared-types';

// The editable form state behind a smart playlist's rules. Kept separate from
// PlaylistFilters because the form needs "enabled" toggles and raw input
// strings (a half-typed year isn't a number yet), while the API wants only the
// filters that are actually set.
export interface RuleDraft {
  matchMode: MatchMode;
  enableYear: boolean;
  yearMin: string;
  yearMax: string;
  enableGenre: boolean;
  genre: string;
  director: string;
  ownership: '' | 'local' | 'server' | 'both';
  qualityIds: number[];
  addedAfter: string;
  enablePlayCount: boolean;
  minPlayCount: string;
  enableArtists: boolean;
  artistIds: number[];
  enableVideos: boolean;
  videoIds: number[];
}

export function emptyRuleDraft(matchMode: MatchMode = 'all'): RuleDraft {
  return {
    matchMode,
    enableYear: false, yearMin: '', yearMax: '',
    enableGenre: false, genre: '',
    director: '', ownership: '', qualityIds: [], addedAfter: '',
    enablePlayCount: false, minPlayCount: '',
    enableArtists: false, artistIds: [],
    enableVideos: false, videoIds: [],
  };
}

export function draftToFilters(draft: RuleDraft): PlaylistFilters {
  const filters: PlaylistFilters = {};
  if (draft.enableYear) {
    if (draft.yearMin) filters.yearMin = Number(draft.yearMin);
    if (draft.yearMax) filters.yearMax = Number(draft.yearMax);
  }
  if (draft.enableGenre && draft.genre.trim()) filters.genre = draft.genre.trim();
  if (draft.director.trim()) filters.director = draft.director.trim();
  if (draft.ownership) filters.ownership = draft.ownership;
  if (draft.qualityIds.length) filters.qualityIds = draft.qualityIds;
  if (draft.addedAfter) filters.addedAfter = new Date(draft.addedAfter).toISOString();
  if (draft.enablePlayCount && draft.minPlayCount) filters.minPlayCount = Number(draft.minPlayCount);
  if (draft.enableArtists && draft.artistIds.length) filters.artistIds = draft.artistIds;
  if (draft.enableVideos && draft.videoIds.length) filters.musicVideoIds = draft.videoIds;
  return filters;
}

// Judged on what would actually be sent, not on which toggles are ticked: a
// ticked "Year range" with both boxes blank produces no filter at all.
export function hasActiveFilter(draft: RuleDraft): boolean {
  return Object.keys(draftToFilters(draft)).length > 0;
}

export function filtersToDraft(filters: PlaylistFilters, matchMode: MatchMode): RuleDraft {
  return {
    matchMode,
    enableYear: filters.yearMin !== undefined || filters.yearMax !== undefined,
    yearMin: filters.yearMin !== undefined ? String(filters.yearMin) : '',
    yearMax: filters.yearMax !== undefined ? String(filters.yearMax) : '',
    enableGenre: filters.genre !== undefined,
    genre: filters.genre ?? '',
    director: filters.director ?? '',
    ownership: filters.ownership ?? '',
    qualityIds: filters.qualityIds ?? [],
    // The date input works in YYYY-MM-DD; the filter is stored as an ISO instant.
    addedAfter: filters.addedAfter ? filters.addedAfter.slice(0, 10) : '',
    enablePlayCount: filters.minPlayCount !== undefined,
    minPlayCount: filters.minPlayCount !== undefined ? String(filters.minPlayCount) : '',
    enableArtists: Boolean(filters.artistIds?.length),
    artistIds: filters.artistIds ?? [],
    enableVideos: Boolean(filters.musicVideoIds?.length),
    videoIds: filters.musicVideoIds ?? [],
  };
}

// Tolerates a malformed stored rule set (it's JSON in a text column) by
// falling back to an empty draft instead of crashing the page.
export function parseStoredRules(ruleFilters: string | null, ruleMatchMode: string | null): RuleDraft {
  const matchMode: MatchMode = ruleMatchMode === 'any' ? 'any' : 'all';
  if (!ruleFilters) return emptyRuleDraft(matchMode);
  try {
    return filtersToDraft(JSON.parse(ruleFilters) as PlaylistFilters, matchMode);
  } catch {
    return emptyRuleDraft(matchMode);
  }
}

interface Props {
  draft: RuleDraft;
  onChange: (draft: RuleDraft) => void;
  // Restricts the "specific video" picker to what the chosen playback library holds.
  targetConnectorId: number | null;
  // Radio groups need a name unique per form on the page.
  idPrefix: string;
}

export function PlaylistRuleFields({ draft, onChange, targetConnectorId, idPrefix }: Props) {
  const set = (patch: Partial<RuleDraft>) => onChange({ ...draft, ...patch });

  const artists = useQuery({ queryKey: ['artists'], queryFn: api.artists.list });
  const qualities = useQuery({ queryKey: ['qualities'], queryFn: api.qualities.list });
  const playable = useQuery({
    queryKey: ['musicVideos', 'playable', targetConnectorId ?? ''],
    queryFn: () => api.musicVideos.list(targetConnectorId ? { playableConnectorId: targetConnectorId } : { playable: true }),
  });

  return (
    <>
      <div className="form-row">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="radio"
            name={`${idPrefix}-matchMode`}
            checked={draft.matchMode === 'all'}
            onChange={() => set({ matchMode: 'all' })}
          />
          Match ALL enabled filters (AND)
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="radio"
            name={`${idPrefix}-matchMode`}
            checked={draft.matchMode === 'any'}
            onChange={() => set({ matchMode: 'any' })}
          />
          Match ANY enabled filter (OR)
        </label>
      </div>

      <div className="form-row" style={{ alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', width: 140 }}>
          <input type="checkbox" checked={draft.enableYear} onChange={(e) => set({ enableYear: e.target.checked })} />
          Year range
        </label>
        <input
          type="number"
          placeholder="Min year"
          aria-label="Minimum year"
          value={draft.yearMin}
          onChange={(e) => set({ yearMin: e.target.value })}
          disabled={!draft.enableYear}
          style={{ width: 110 }}
        />
        <input
          type="number"
          placeholder="Max year"
          aria-label="Maximum year"
          value={draft.yearMax}
          onChange={(e) => set({ yearMax: e.target.value })}
          disabled={!draft.enableYear}
          style={{ width: 110 }}
        />
      </div>

      <div className="form-row" style={{ alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', width: 140 }}>
          <input type="checkbox" checked={draft.enableGenre} onChange={(e) => set({ enableGenre: e.target.checked })} />
          Genre
        </label>
        <input
          placeholder="e.g. Rock"
          aria-label="Genre"
          value={draft.genre}
          onChange={(e) => set({ genre: e.target.value })}
          disabled={!draft.enableGenre}
          style={{ minWidth: 180 }}
        />
        <span className="empty-state" style={{ padding: 0 }}>
          matches artist or video genre, partial match
        </span>
      </div>

      <div className="form-row" style={{ alignItems: 'center' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', width: 140 }}>
          <input
            type="checkbox"
            checked={draft.enablePlayCount}
            onChange={(e) => set({ enablePlayCount: e.target.checked })}
          />
          Min play count
        </label>
        <input
          type="number"
          min={0}
          placeholder="e.g. 5"
          aria-label="Minimum play count"
          value={draft.minPlayCount}
          onChange={(e) => set({ minPlayCount: e.target.value })}
          disabled={!draft.enablePlayCount}
          style={{ width: 110 }}
        />
        <span className="empty-state" style={{ padding: 0 }}>
          requires a library connector's "Sync Play Counts" to have run
        </span>
      </div>

      <div className="form-row" style={{ alignItems: 'center' }}>
        <input aria-label="Director" placeholder="Director" value={draft.director} onChange={(e) => set({ director: e.target.value })} />
        <select aria-label="Ownership" value={draft.ownership} onChange={(e) => set({ ownership: e.target.value as RuleDraft['ownership'] })}>
          <option value="">Any ownership</option>
          <option value="local">Local only</option>
          <option value="server">Media server only</option>
          <option value="both">Local and media server</option>
        </select>
        <select
          multiple
          aria-label="Quality"
          value={draft.qualityIds.map(String)}
          onChange={(e) => set({ qualityIds: [...e.target.selectedOptions].map((option) => Number(option.value)) })}
          style={{ minWidth: 150, height: 72 }}
        >
          {qualities.data?.map((quality) => <option key={quality.id} value={quality.id}>{quality.name}</option>)}
        </select>
        <label>Added after <input type="date" aria-label="Added after" value={draft.addedAfter} onChange={(e) => set({ addedAfter: e.target.value })} /></label>
      </div>

      <div className="form-row" style={{ alignItems: 'flex-start' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', width: 140, marginTop: 6 }}>
          <input
            type="checkbox"
            checked={draft.enableArtists}
            onChange={(e) => set({ enableArtists: e.target.checked })}
          />
          Artist
        </label>
        <select
          multiple
          aria-label="Filter by artist"
          disabled={!draft.enableArtists}
          value={draft.artistIds.map(String)}
          onChange={(e) => set({ artistIds: [...e.target.selectedOptions].map((o) => Number(o.value)) })}
          style={{ minWidth: 220, height: 90 }}
        >
          {artists.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-row" style={{ alignItems: 'flex-start' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', width: 140, marginTop: 6 }}>
          <input
            type="checkbox"
            checked={draft.enableVideos}
            onChange={(e) => set({ enableVideos: e.target.checked })}
          />
          Specific video
        </label>
        <select
          multiple
          aria-label="Filter by specific video"
          disabled={!draft.enableVideos}
          value={draft.videoIds.map(String)}
          onChange={(e) => set({ videoIds: [...e.target.selectedOptions].map((o) => Number(o.value)) })}
          style={{ minWidth: 280, height: 90 }}
        >
          {playable.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.artist.name} - {v.title}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
