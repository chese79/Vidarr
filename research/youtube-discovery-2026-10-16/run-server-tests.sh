#!/bin/sh
set -eu
# Isolated disposable test container only. Keep SQLite semantics/migrations while
# avoiding overlay-filesystem fsync contention with the running production app.
cp -a /app/apps/server/prisma /dev/shm/vidarr-test-prisma
mv /app/apps/server/prisma /app/apps/server/prisma-image
ln -s /dev/shm/vidarr-test-prisma /app/apps/server/prisma
cd /app/apps/server
exec /app/node_modules/.bin/vitest run --testTimeout 30000 --hookTimeout 30000
