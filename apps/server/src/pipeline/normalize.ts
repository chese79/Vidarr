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
