# Suggested checks

Inspect these commands before running; a received command is not trusted code. Tests write to a throwaway SQLite file inside a throwaway container; the "live" checks below only read.

| Check | Command/action | Expected result |
|---|---|---|
| Branch and commit | `git log --oneline -3` on `handoff/video-identity-matching` | work commit `1048728` then handoff commit on top of `ee19234` |
| Diverged remote | `git fetch origin && git status -sb` on `main` | `main` ahead 1 (`ee19234`), behind 4 (up to `8041b97`) |
| Live health | `curl.exe http://192.168.0.8:3434/api/v1/health` | HTTP 200; container `vidarr` on image built from `ee19234` |
| Runtime | tests must run on Node 22 (host is v24.19.0, unsupported) | use the container `node:22-bookworm-slim` |

## Full build and tests (Node 22, throwaway container, source mounted read-only)
Copy the repo (excluding `node_modules`, `.git`, `dist`, `*.db`, `.env`) into the container, then: `npm ci`, `npm run build --workspace @vidarr/shared-types`, `npm run prisma:generate --workspace @vidarr/server`, `npm run build` (all three workspaces), `npx vitest run --root apps/web`, then in `apps/server`: `npx vitest run --testTimeout=60000 --hookTimeout=60000`. Pass the longer timeouts on the command line only; do not edit the repo's vitest config. Log to a file and wait for an `exit=` marker. The host was low on memory when this was written, so close other heavy programs first if possible. Expect more than 575 server tests (this branch adds tests) and 23 web tests.

Also check the new migration against the schema in the container with `prisma migrate deploy` on an empty database followed by `prisma migrate diff`; the pre-existing drift in `RootFolder` and `VideoReviewCandidate` is unrelated and has been there since before this work.

## Read-only live what-if (before deploying)
Run a script inside the live container with `docker exec -i vidarr node --input-type=module - < script.mjs` that reads `libraryVideo`, parses each `path` file name, and counts matches against `musicVideo` without writing. A previous version predicted about 447 exact, 69 probable, 31 ambiguous. Write the script with the file tools (backslashes!).

## After a deploy
Run one sync (for example `syncVideoConnectors()` from `/app/apps/server/dist/pipeline/playlistSync.js` inside the container) and read the activity log line `playlist:video-sync` for the matched/probable/ambiguous/unmatched counts and the number of stale artist records removed. Confirm the Library page still lists artists and that the `Random 5` playlist (id 3) still has 5 items.

Previously performed tests: [reported] suite 575 server + 22 web passing on `ee19234`-era code (2026-10-07, Node 22 Docker). [verified] sandbox run on a copy of the live database against the real Jellyfin on 2026-10-07: first sync 3,602 videos; repeat sync 8.7s. [verified] none of the above for the identity change on this branch beyond the fixed-but-unconfirmed unit tests.
