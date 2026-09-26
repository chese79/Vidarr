const AUTHORITY_RANK: Record<string, number> = {
  authoritative: 0,
  verified: 1,
  manual: 2,
  heuristic: 3,
};

export function preferredDirectSource<T extends { id: number; authority: string; url: string }>(sources: T[]): T | undefined {
  return sources
    .filter((source) => /^https?:\/\//i.test(source.url))
    .sort((a, b) => (AUTHORITY_RANK[a.authority] ?? 4) - (AUTHORITY_RANK[b.authority] ?? 4) || a.id - b.id)[0];
}
