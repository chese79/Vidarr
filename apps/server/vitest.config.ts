import { defineConfig } from 'vitest/config';

// A dedicated SQLite file, migrated fresh by test/globalSetup.ts before any
// test runs — kept out of dev.db entirely so running tests never touches
// (or races with) a real local dev database. Prisma resolves a sqlite
// "file:" URL relative to prisma/schema.prisma's own directory, not cwd —
// this lands at apps/server/prisma/test.db (same as dev.db does).
const TEST_DATABASE_URL = 'file:./test.db';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      NODE_ENV: 'test',
    },
    // DB-backed tests share one on-disk SQLite file (see test/support/db.ts's
    // resetDb) — parallel workers would race on the same rows.
    fileParallelism: false,
  },
});
