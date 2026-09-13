import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const TEST_DATABASE_URL = 'file:./test.db';
const dbPath = path.resolve(import.meta.dirname, '../prisma/test.db');

// Runs once before the whole test run (vitest globalSetup), in its own
// process — separate from the env vitest.config.ts's `test.env` injects into
// the actual test files, so DATABASE_URL is passed explicitly to the child
// `prisma migrate deploy` process rather than relied on to propagate here.
export default function setup() {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    const p = dbPath + suffix;
    if (existsSync(p)) rmSync(p);
  }

  // Invoke the prisma CLI's own JS entrypoint directly with `node` rather than
  // shelling out to `npx`/`npx.cmd` — avoids both the cross-platform .cmd
  // quirk (execFileSync can't launch a Windows .cmd without shell: true) and
  // the args-with-shell:true footgun, with no shell involved at all.
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
