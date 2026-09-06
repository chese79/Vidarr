import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Imported first (before ./db/client.js) so DATABASE_URL etc. are in
// process.env before anything constructs PrismaClient. Docker and the
// systemd unit in docs/deployment.md already inject real env vars (via
// Dockerfile ENV / EnvironmentFile=) before node starts, so this is a no-op
// there — it only matters for running dist/main.js directly (or tsx in
// dev) with a .env file instead. Hand-rolled rather than the `dotenv`
// package or Node's --env-file flag: no new dependency, and --env-file
// isn't forwarded through tsx and errors if the file is missing.
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(moduleDir, '../.env');

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);

    // Real environment variables (Docker/systemd) always win over .env.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
