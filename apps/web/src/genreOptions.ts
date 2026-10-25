import type { GenreStats } from '@vidarr/shared-types';

export function genreFilterOptions(stats: GenreStats | undefined, legacy: Array<{genre?: string | null}>): string[] {
  return [...new Set(stats ? stats.genres.flatMap(g => [
    ...(!g.isOther ? [g.name] : []), ...g.subgenres.map(s => s.name),
  ]) : legacy.flatMap(a => a.genre?.split(',').map(g => g.trim()).filter(Boolean) ?? []))].sort();
}
