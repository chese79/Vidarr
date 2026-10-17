"""Read-only comparison against the offline deployment backup; outputs counts only."""
import json, sqlite3
from pathlib import Path
snapshot=json.loads(Path('/backup/snapshot.json').read_text())
with sqlite3.connect('file:/config/vidarr.db?mode=ro',uri=True) as database:
    assert database.execute('PRAGMA quick_check').fetchone()[0]=='ok'
    missing={};counts={}
    for table in ['Artist','MusicVideo','DownloadQueueItem','VideoReviewCandidate','MusicVideoFile']:
        current={row[0] for row in database.execute(f'SELECT id FROM "{table}"')}
        missing[table]=len(set(snapshot[table])-current);counts[table]=len(current)
    assert not any(missing.values()),missing
print(json.dumps({'databaseIntegrity':'ok','missingOriginalRows':missing,'currentCounts':counts}))
