import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('preserves populated catalog, queue reservations, file/count and playlist identities across the shared-target migration', () => {
  const db = new DatabaseSync(':memory:');
  const root = new URL('../prisma/migrations/', import.meta.url), current = '20261018010000_live_workflows';
  try {
    for (const name of readdirSync(root).filter(name => name < current).sort()) db.exec(readFileSync(new URL(`${name}/migration.sql`, root), 'utf8'));
    db.exec(`INSERT INTO RootFolder (id,path) VALUES (1,'/media/kept');
      INSERT INTO Quality (id,name,source,weight) VALUES (1,'Any','unknown',1);
      INSERT INTO QualityProfile (id,name,cutoffQualityId) VALUES (1,'Any',1);
      INSERT INTO Artist (id,name,sortName,rootFolderId,qualityProfileId) VALUES (1,'Artist','Artist',1,1);
      INSERT INTO MusicVideo (id,artistId,title,normalizedTitle,hasFile,qualifiedPlayCount,isLiveConcert) VALUES (1,1,'Kept','kept',1,7,1);
      INSERT INTO MusicVideoFile (id,musicVideoId,path,sizeBytes,originalFilename,playCount) VALUES (1,1,'/media/kept/video.mp4',1000,'video.mp4',11);
      INSERT INTO DownloadQueueItem (id,musicVideoId,sourceType,sourceRef,status,queuePosition,stagingDirectory) VALUES (1,1,'youtube','https://example.com','submissionUnknown',-10,'/tmp/staged');
      INSERT INTO DownloadQueueItem (id,musicVideoId,sourceType,sourceRef,status) VALUES (100,1,'youtube','retired','failed');
      DELETE FROM DownloadQueueItem WHERE id=100;
      INSERT INTO Playlist (id,name) VALUES (1,'Playlist');
      INSERT INTO PlaylistItem (id,playlistId,musicVideoId,sortOrder) VALUES (1,1,1,12);
      INSERT INTO LivePerformance (id,artistId,title,updatedAt) VALUES (1,1,'Existing event',CURRENT_TIMESTAMP);
      INSERT INTO LiveSongPerformance (id,performanceId,position,title) VALUES (1,1,1,'Repeated'),(2,1,2,'Repeated');
      INSERT INTO Recording (id,title) VALUES (1,'Existing recording');
      INSERT INTO RecordingPerformance (recordingId,performanceId) VALUES (1,1);`);
    const tables = ['Artist', 'MusicVideo', 'MusicVideoFile', 'DownloadQueueItem', 'Playlist', 'PlaylistItem', 'LivePerformance', 'LiveSongPerformance', 'Recording'];
    const before = tables.map(table => db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all());
    db.exec(readFileSync(new URL(`${current}/migration.sql`, root), 'utf8'));
    for (const [index, table] of tables.entries()) {
      const rows = db.prepare(`SELECT * FROM "${table}" ORDER BY id`).all();
      if (table === 'Recording') expect(rows.length).toBeGreaterThan(before[index].length);
      else expect(rows).toHaveLength(before[index].length);
      before[index].forEach((row, i) => expect(rows[i]).toMatchObject(row));
    }
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => db.exec(`INSERT INTO DownloadQueueItem (musicVideoId,sourceType,sourceRef,status) VALUES (1,'youtube','duplicate','importing')`)).toThrow();
    db.exec(`INSERT INTO DownloadQueueItem (recordingId,sourceType,sourceRef,status) VALUES (1,'youtube','live','queued')`);
    expect(Number(db.prepare("SELECT id FROM DownloadQueueItem WHERE sourceRef='live'").get()!.id)).toBeGreaterThan(100);
    expect(() => db.exec(`INSERT INTO DownloadQueueItem (recordingId,sourceType,sourceRef,status) VALUES (1,'youtube','duplicate','importing')`)).toThrow();
    expect(() => db.exec(`INSERT INTO DownloadQueueItem (sourceType,sourceRef,status) VALUES ('youtube','orphan','queued')`)).toThrow();
    expect(() => db.exec(`INSERT INTO DownloadQueueItem (musicVideoId,recordingId,sourceType,sourceRef,status) VALUES (1,1,'youtube','ambiguous','failed')`)).toThrow();
  } finally { db.close(); }
});
