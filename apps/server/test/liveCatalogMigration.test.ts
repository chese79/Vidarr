import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('adds the live catalog to a populated legacy schema without changing file/count/queue/playlist identities', () => {
  const db = new DatabaseSync(':memory:');
  const root = new URL('../prisma/migrations/', import.meta.url);
  const liveMigration = '20261017210000_live_catalog_foundation';
  try {
    for (const migration of readdirSync(root).filter(name => name < liveMigration).sort()) {
      db.exec(readFileSync(new URL(`${migration}/migration.sql`, root), 'utf8'));
    }
    db.exec(`INSERT INTO RootFolder (id,path) VALUES (1,'/media/kept');
      INSERT INTO Quality (id,name,source,weight) VALUES (1,'Any','unknown',1);
      INSERT INTO QualityProfile (id,name,cutoffQualityId) VALUES (1,'Any',1);
      INSERT INTO Artist (id,name,sortName,rootFolderId,qualityProfileId) VALUES (1,'Preserved','Preserved',1,1);
      INSERT INTO MusicVideo (id,artistId,title,normalizedTitle,hasFile,qualifiedPlayCount,isLiveConcert) VALUES (1,1,'Kept','kept',1,7,1);
      INSERT INTO MusicVideoFile (id,musicVideoId,path,sizeBytes,originalFilename,playCount) VALUES (1,1,'/media/kept/video.mp4',1000,'video.mp4',11);
      INSERT INTO DownloadQueueItem (id,musicVideoId,sourceType,sourceRef,status,queuePosition,stagingDirectory) VALUES (1,1,'youtube','https://example.com','submissionUnknown',-10,'/tmp/staged');
      INSERT INTO Playlist (id,name) VALUES (1,'Preserved playlist');
      INSERT INTO PlaylistItem (id,playlistId,musicVideoId,sortOrder) VALUES (1,1,1,12);`);
    const tables = ['Artist', 'MusicVideo', 'MusicVideoFile', 'DownloadQueueItem', 'Playlist', 'PlaylistItem'];
    const before = tables.map(table => db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all());
    db.exec(readFileSync(new URL(`${liveMigration}/migration.sql`, root), 'utf8'));
    expect(tables.map(table => db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all())).toEqual(before);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM LivePerformance').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM Recording').all()).toEqual([]);
    // No automatic classification, fabricated recording or file move is implied.
    db.exec(`INSERT INTO LivePerformance (artistId,title,updatedAt) VALUES (1,'Independent',CURRENT_TIMESTAMP)`);
    expect(() => db.exec('DELETE FROM Artist WHERE id=1')).toThrow();
  } finally { db.close(); }
});
