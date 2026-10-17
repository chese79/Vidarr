"""Offline configuration backup for the authorized Vidarr-only deployment.

Run in a helper with the stopped Vidarr mounts read-only and a new /backup volume.
Never copies media/staging bytes or writes configuration. Secrets stay in backup volume.
"""
import hashlib, json, os, shutil, sqlite3, tarfile
from pathlib import Path

config = Path('/config')
database = config / 'vidarr.db'
backup = Path('/backup')
os.umask(0o077)
assert database.is_file() and backup.is_dir()
# The service is stopped. Copy its database and recovery sidecars as one offline
# snapshot, then recover/check only the private copy. SQLite's backup API can
# wait indefinitely against the read-only Docker Desktop bind mount and WAL.
for suffix in ['', '-wal', '-shm', '-journal']:
    destination = backup / ('vidarr.db' + suffix)
    if destination.exists():
        destination.unlink()
for suffix in ['', '-wal', '-journal']:
    original = config / ('vidarr.db' + suffix)
    if original.exists():
        shutil.copyfile(original, backup / original.name)
with sqlite3.connect(backup / 'vidarr.db') as source:
    assert source.execute('PRAGMA quick_check').fetchone()[0] == 'ok'
    source.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    tables = ['Artist', 'MusicVideo', 'DownloadQueueItem', 'VideoReviewCandidate', 'MusicVideoFile']
    snapshot = {table: [r[0] for r in source.execute(f'SELECT id FROM "{table}" ORDER BY id')] for table in tables}
source.close()
with tarfile.open(backup / 'config.tar', 'w') as archive:
    for entry in config.iterdir():
        if not entry.name.startswith('vidarr.db'):
            archive.add(entry, arcname=entry.name)
snapshot['sha256'] = {name: hashlib.file_digest((backup / name).open('rb'), 'sha256').hexdigest() for name in ['vidarr.db', 'config.tar']}
snapshot['stagingMount'] = '/tmp/vidarr-staging'
snapshot['stagedFiles'] = sum(1 for f in Path('/tmp/vidarr-staging').rglob('*') if f.is_file())
(backup / 'snapshot.json').write_text(json.dumps(snapshot))
print(json.dumps({'backupVerified': True, 'counts': {table: len(snapshot[table]) for table in tables}, 'stagedFiles': snapshot['stagedFiles']}), flush=True)
