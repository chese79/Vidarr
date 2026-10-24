import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('adds discovery inventory to a populated catalog without changing media or review identities', () => {
  const db = new DatabaseSync(':memory:');
  const root = new URL('../prisma/migrations/', import.meta.url), name = '20261023010000_live_starting_inventory';
  try {
    for (const migration of readdirSync(root).filter(value => value < name).sort()) db.exec(readFileSync(new URL(`${migration}/migration.sql`, root), 'utf8'));
    db.exec(`INSERT INTO Settings(id,imvdbApiKey) VALUES(1,'fixture-secret');
      INSERT INTO RootFolder(id,path) VALUES(1,'/media/kept');
      INSERT INTO Quality(id,name,source,weight) VALUES(1,'Any','unknown',1);
      INSERT INTO QualityProfile(id,name,cutoffQualityId) VALUES(1,'Any',1);
      INSERT INTO Artist(id,name,sortName,rootFolderId,qualityProfileId) VALUES(1,'Adele','Adele',1,1);
      INSERT INTO MusicVideo(id,artistId,title,normalizedTitle) VALUES(1,1,'Kept','kept');
      INSERT INTO VideoReviewCandidate(artistId,source,externalId,title,artistName,decision,updatedAt) VALUES(1,'youtube','keep-id','Live song','Adele','rejected',CURRENT_TIMESTAMP);
      INSERT INTO LiveConfiguration(id,setlistApiKey) VALUES(1,'fixture-provider-secret');`);
    const tables=['MusicVideo','VideoReviewCandidate','LiveConfiguration'];
    const before=tables.map(t=>db.prepare(`SELECT * FROM "${t}"`).all());
    db.exec(readFileSync(new URL(`${name}/migration.sql`,root),'utf8'));
    expect(tables.map(t=>db.prepare(`SELECT * FROM "${t}"`).all())).toEqual(before);
    expect(db.prepare('SELECT liveEnabled,imvdbApiKey FROM Settings').get()).toEqual({liveEnabled:1,imvdbApiKey:'fixture-secret'});
    expect(db.prepare('SELECT liveDiscoveryStatus FROM Artist').get()).toEqual({liveDiscoveryStatus:'pending'});
    expect(db.prepare('SELECT * FROM LiveDiscoveryItem').all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
