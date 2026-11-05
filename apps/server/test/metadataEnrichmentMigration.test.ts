import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
it('adds enrichment tables to a populated database without altering inventory, playlists or credentials', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const root = path.resolve(import.meta.dirname, '../prisma/migrations');
    const migrations = readdirSync(root).filter(name => /^\d/.test(name)).sort();
    for (const name of migrations.filter(name => name !== '20261105010000_metadata_enrichment')) db.exec(readFileSync(path.join(root, name, 'migration.sql'), 'utf8'));
    db.exec(`INSERT INTO LibraryConnector (id,name,type,host,authToken,videoLibraryId) VALUES (4,'JF','jellyfin','http://fixture:8096','private-fixture-key','music-videos');
      INSERT INTO LibraryVideo (id,connectorId,externalId,title,normalizedTitle,artistName,normalizedArtistName,lastSyncedAt) VALUES (77,4,'server-video','Tomorrow','tomorrow','Morrissey','morrissey',CURRENT_TIMESTAMP);
      INSERT INTO Playlist (id,name,createdAt) VALUES (16,'Awesome playlist #5',CURRENT_TIMESTAMP);`);
    const before = ['LibraryConnector', 'LibraryVideo', 'Playlist'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
    db.exec(readFileSync(path.join(root, '20261105010000_metadata_enrichment/migration.sql'), 'utf8'));
    expect(['LibraryConnector', 'LibraryVideo', 'Playlist'].map(table => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    db.exec(`INSERT INTO MetadataEnrichmentRun (connectorId,serverId,libraryId,highWaterId,updatedAt) VALUES (4,'server','music-videos',77,CURRENT_TIMESTAMP)`);
    expect(db.prepare('SELECT status,cursor FROM MetadataEnrichmentRun').get()).toEqual({ status: 'running', cursor: 0 });
  } finally { db.close(); }
});
