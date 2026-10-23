"""Exercise offline snapshots against disposable legacy and Live SQLite fixtures."""
import contextlib
import hashlib
import io
import json
import sqlite3
import tempfile
from pathlib import Path

helper = Path(__file__).with_name('deploy-backup.py').read_text()
core = ['Artist', 'MusicVideo', 'DownloadQueueItem', 'VideoReviewCandidate', 'MusicVideoFile']
live = ['LivePerformance', 'LiveSongPerformance', 'Recording', 'RecordingPart', 'LiveMonitoringRule', 'Playlist']
for with_live in [False, True]:
    with tempfile.TemporaryDirectory() as temporary:
        config, backup = Path(temporary) / 'config', Path(temporary) / 'backup'
        config.mkdir()
        backup.mkdir()
        tables = core + (live if with_live else [])
        with sqlite3.connect(config / 'vidarr.db') as database:
            for table in tables:
                database.execute(f'CREATE TABLE "{table}" (id INTEGER PRIMARY KEY)')
                database.execute(f'INSERT INTO "{table}" VALUES (7)')
        before = hashlib.sha256((config / 'vidarr.db').read_bytes()).hexdigest()
        (config / 'fixture.json').write_text('{"fixture": true}')
        fixture_helper = helper.replace("config = Path('/config')", f'config = Path({str(config)!r})')
        fixture_helper = fixture_helper.replace("backup = Path('/backup')", f'backup = Path({str(backup)!r})')
        with contextlib.redirect_stdout(io.StringIO()):
            exec(compile(fixture_helper, 'deploy-backup.py', 'exec'), {'__name__': '__main__'})
        snapshot = json.loads((backup / 'snapshot.json').read_text())
        assert all(snapshot[table] == [7] for table in tables)
        assert all(table not in snapshot for table in live if table not in tables)
        assert before == hashlib.sha256((config / 'vidarr.db').read_bytes()).hexdigest()
        for name in ['vidarr.db', 'config.tar']:
            assert snapshot['sha256'][name] == hashlib.sha256((backup / name).read_bytes()).hexdigest()
print(json.dumps({'legacySnapshotPassed': True, 'liveSnapshotPassed': True, 'sourceDatabasesUnchanged': True}))
