// Escapes SQLite LIKE's own wildcards so a search term containing "%" or "_"
// is matched literally rather than as a pattern.
export function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

