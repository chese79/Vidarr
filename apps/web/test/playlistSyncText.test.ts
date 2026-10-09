import { describe, expect, it } from 'vitest';
import { describeSync, syncNeedsAttention } from '../src/pages/playlistSyncText';

describe('describeSync', () => {
  it('says nothing when no connector took part', () => {
    expect(describeSync(undefined)).toBe('');
    expect(describeSync([])).toBe('');
  });

  it('reports a successful sync with its video count', () => {
    expect(describeSync([{ connectorId: 1, name: 'JF', status: 'synced', videoCount: 1 }])).toBe('Synced JF (1 video).');
    expect(describeSync([{ connectorId: 1, name: 'JF', status: 'synced', videoCount: 120 }])).toBe('Synced JF (120 videos).');
  });

  it('says how many videos matched the catalog, since only those can join a playlist', () => {
    expect(describeSync([{ connectorId: 1, name: 'JF', status: 'synced', videoCount: 3602, matchedCount: 551 }]))
      .toBe('Synced JF (3602 videos, 551 matched to your catalog).');
  });

  it('spells out a failure and that older data was used', () => {
    const text = describeSync([{ connectorId: 1, name: 'JF', status: 'failed', message: 'timed out' }]);
    expect(text).toContain('Could not sync JF (timed out)');
    expect(text).toContain('used the last synced data');
  });

  it('reports a skipped sync using its message and joins several connectors', () => {
    const text = describeSync([
      { connectorId: 1, name: 'JF', status: 'skipped', message: 'A sync is already running; using its last results.' },
      { connectorId: 2, name: 'Plex', status: 'synced', videoCount: 5 },
    ]);
    expect(text).toBe('JF: A sync is already running; using its last results. Synced Plex (5 videos).');
  });

  it('flags only failures as needing attention', () => {
    expect(syncNeedsAttention([{ connectorId: 1, name: 'JF', status: 'skipped' }])).toBe(false);
    expect(syncNeedsAttention([{ connectorId: 1, name: 'JF', status: 'failed' }])).toBe(true);
  });
});
