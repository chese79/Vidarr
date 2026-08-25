export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics after NFKD decomposition
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function sortNameFor(name: string): string {
  return name.replace(/^(the|a|an)\s+/i, '').trim();
}

// Strips ALL non-alphanumeric characters (no spaces retained) — for comparing
// against channel handles/names that often omit spacing and punctuation
// entirely (e.g. "remhq", "RickAstleyYT").
export function squash(value: string): string {
  return normalizeTitle(value).replace(/\s+/g, '');
}
