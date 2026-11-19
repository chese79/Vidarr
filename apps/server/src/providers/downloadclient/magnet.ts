// qBittorrent addresses jobs by a 20-byte SHA-1 encoded as 40 hexadecimal digits.
export function magnetInfoHash(url: string): string | null {
  const value = /(?:[?&]xt=urn:btih:)([a-f0-9]{40}|[a-z2-7]{32})(?=&|$)/i.exec(url)?.[1];
  return value ? normalizeTorrentHash(value) : null;
}

export function normalizeTorrentHash(value: string): string | null {
  if (!/^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(value)) return null;
  if (value.length === 40) return value.toLowerCase();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, buffer = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase()) {
    buffer = (buffer << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); }
  }
  return Buffer.from(bytes).toString('hex');
}
