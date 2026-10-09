# Handoff: Vidarr — video-identity matching (finish, test, merge, deploy)

## Receiving-session status, 2026-10-08

The original outgoing snapshot below is historical context. The receiver verified the committed
handoff with the installed schema-2.0 Git verifier, and the user approved GPT-6 Codex and requested
completion of the open work. The four upstream review-fix commits were already reviewed, tested,
and merged by this receiving conversation. The branch now integrates them. Automatic stale-artist
deletion was removed to preserve existing artists and provenance; bracketed version labels,
empty identities, and stored exact-match identities received regression fixes. [verified] The final
Node 22 Docker build passed, with 621 server tests and 23 web tests passing and all 32 migrations
applied to disposable SQLite data. [verified] PR #3 merged the work into `main` at
`e78b6915d8cafd3af0c357f9cf85091c7794f8d9`; the automatic Docker publication succeeded.
[verified] The live `vidarr` service runs that production revision and is healthy with its original
environment, mounts, port binding, and restart policy. Database backups and `vidarr-pre-e78b691`
are retained. A completed Jellyfin sync inventoried 3,602 videos with 527 exact matches (previously
1); all original artist IDs and playlist items/order remain. The additive genre-attempt migration
is applied and the Library API returns 200. The obsolete October 4 root handoff was archived
outside the repository. This handoff's implementation, testing, merge, deployment, and live
acceptance work is complete; the outgoing snapshot's proposed actions below are historical.

Tier: Standard — one feature in flight across code, a live deployment, and a diverged remote; context beyond the diff is essential.
Created: 2026-10-08 20:50, America/Chicago (-05:00)
Intended receiver: another Claude Code / Codex session on this same machine (Windows 10, Docker Desktop).

## Mission and completion criteria

Server videos in the user's Jellyfin library almost never match Vidarr's catalog, so playlists can hold almost nothing. Done means: the work on this branch passes the full build and test suite on Node 22, is merged into `main` together with the commits already on `origin/main`, is deployed to the live `vidarr` container using the procedure below, and a live sync shows far more than 1 exact catalog match (the what-if predicted ~447). The user asked "merge and deploy" on 2026-10-08 and it was **not** done because the suite was not green.

## Current state

- [verified] Branch `handoff/video-identity-matching`, work commit `10487280b525a7091f0199214c7638585f3c4b4a`, directly on top of local `main` = `ee19234`.
- [verified] The work commit is unmerged, undeployed, and has **no CHANGELOG entry yet** (AGENTS.md requires one in the same commit as user-visible changes).
- [verified] Live container `vidarr` (image `vidarr-candidate:latest`, built from `ee19234`) is healthy at `http://192.168.0.8:3434` (checked 2026-10-08 ~20:40). It does **not** contain this branch.
- [verified] `origin/main` = `8041b97`, four commits by `cchesebro-prog` dated 2026-10-08 that local `main` lacks (`517a857`, `163cb36`, `3004b07`, `8041b97`). They change `artistGenres.ts`, `import.ts`, `metadataRefresh.ts`, `transfer.ts`, `scheduler/jobs.ts`, `schema.prisma`, `product-vision.md`, `CHANGELOG.md` and tests, and add migration `20261008120000_genre_refresh_attempts` (adds `Artist.genresRefreshAttemptedAt`). Local `main` is ahead by 1 (`ee19234`, unpushed) and behind by 4. By file name the only overlap with `ee19234` plus this branch is `CHANGELOG.md`. Merge conflicts beyond that are UNKNOWN. **I have not reviewed those four commits, and deploying merged `main` would ship them untested by me.**
- [verified] Live database (read 2026-10-08 ~20:40): 1,980 artists; 3,602 `LibraryVideo` rows of which exactly 1 is an exact catalog match; 31 migrations applied (not the upstream one); playlists 1 `aweaom` and 2 `test2` (empty, static) and 3 `Random 5` (static, 5 local Alice in Chains videos).
- [verified] Why matching fails: Jellyfin reports the uploader channel or `Unknown Artist` as each video's artist, but the file name (full Windows path, e.g. `D:\media\libraries\music videos\Deftones - 7 Words.mp4`) is `Artist - Title`. A read-only what-if on the live data predicted about 447 exact, 69 probable, 31 ambiguous matches; 1,218 videos belong to an artist Vidarr already has, 811 of those have a catalog. About 2,191 videos belong to artists Vidarr does not have yet, and most real artists have no catalog.
- [verified] Test status of **this branch**: not green and not known. The last complete passing suite (575 server, 22 web) was on `ee19234`-era code, 2026-10-07. After the identity change: run 1 had 7 failures (two were my wrong assertions, five were 5-second timeouts); a subset rerun had 4 failures (one more of my wrong assertions, three timeouts); I then fixed the assertion mistakes and started a full run, which died with `error waiting for container: unexpected EOF` (Docker connection dropped). The fixes are in the commit but never confirmed green.
- [verified] The host is short of memory: 0.7 GB free of 7.9 GB, Docker VM about 3.77 GB. Tests that normally take 0.3s took 1–3s and unrelated tests hit the default 5s timeout.
- [verified] A bug shipped in the deployed `ee19234`: in `libraryVideoSync.ts` the sort-name regex lost its backslash (`/^thes+/`), so artists created by a sync keep a leading "The" in `sortName`. Fixed in this branch (`/^the\s+/i`). 10 live artists currently have names starting "The " and a sort name starting "The "; whether all were created after `ee19234` is UNKNOWN.
- [verified] Side effect already in live data: the first live on-demand sync created about 414 artist records named after uploader channels (1,566 → 1,980 artists), all unmatched. This branch retires such records on the next sync (see Decisions).

## Proposed next actions

1. Read-only orientation: `git log --oneline -3`, `git status`, `docker ps`, health check `http://192.168.0.8:3434/api/v1/health`. Do not run anything that writes.
2. Do NOT use `main` or the live container yet. In a scratch branch from `origin/main`, merge this branch (`git switch -c scratch/merge-check origin/main` then `git merge handoff/video-identity-matching`), resolve `CHANGELOG.md` only, and **review the four upstream commits** as a PR (`git log -p main..origin/main`).
3. Run the full build and tests in a Node 22 container against that merge, with a longer timeout on the command line only (do not edit the repo's config): see `verify.md`. Wait for `exit=0` in the log. If the Docker connection drops, rerun.
4. Add the missing `CHANGELOG.md` entry and, if behavior changes, `docs/product-vision.md` (video credits now go to the parsed artist; leftover uploader records are retired). Commit with a descriptive message per CLAUDE.md.
5. Report results to the user and **re-confirm** merge and deploy: the earlier "merge and deploy" predates the discovery of upstream commits and of the record-deleting cleanup (open question 1).
6. On approval: merge, then deploy exactly as in Gotchas, then verify with a live sync (see `verify.md`). Expect confirmed matches to rise from 1 to roughly 400+, and uploader-named leftovers to disappear.
7. Pushing to `origin/main` publishes a public Docker image (CLAUDE.md), so push only when the user says so.

## Decisions and rejected approaches

Full log in `decisions.md`. Short version:
- Genres (shipped and pushed as `72a99d7`): per-source rows kept side by side; precedence user > media-server/file tags > MusicBrainz+Last.fm merged; capped 3 genres / 5 sub-genres; Last.fm tags count only if they are MusicBrainz genres; songs inherit the artist's genres.
- Playlist creation re-reads the media server first (`ee19234`, local only, deployed). A failed sync never blocks creation; a running sync is skipped; scheduled regeneration does not sync.
- This branch: identities from file name, then server title, then server metadata; strongest match across them wins; stored normalized names follow the best identity; artist records are created from the parsed artist and only fall back to the server's artist when nothing parses.
- Rejected: using the server's artist only when it has a VEVO suffix — it would stop recording correctly tagged artists in well-tagged libraries.

## Gotchas and open questions

1. **Open — needs the user's approval:** the sync now **deletes** artist records left by earlier syncs. Conditions (all required): link not renewed this sync, status `unmatched`, no MusicBrainz ID, not monitored, no other sources, no catalog videos, no YouTube sources, no review candidates, no MusicBrainz candidates; skipped when the server returns no videos. It was designed for the ~414 uploader records but the user has not seen or approved this deletion behavior.
2. **Open:** merge conflicts and the quality of the four upstream commits are UNKNOWN.
3. **Open:** whether the user wants stale-record cleanup at all, or the junk left for Match Review.
4. The shell tool **collapses doubled backslashes** in commands. Twice this corrupted code (`/^thes+/`, `[\/]`). Write or edit any code or script containing backslashes with the file tools, never with `node -e`, heredocs or sed.
5. Backgrounded `... &` commands return instantly and fire a "completed" notification while the job keeps running. Wait on the log file for an `exit=` marker with a separate until-loop.
6. The PowerShell tool blocked a command that contained the text of a delete (`rm`, and a `{{"\n"}}` format string) before running it. Use `docker rename` and avoid `rm`.
7. The skill's `git_handoff.py` could not run: `python` is only the Windows Store shim and Python is not installed. The pre-snapshot checks were done by hand (see Git). Run `verify` once Python exists.
8. Credentials: the user pasted a Last.fm API key and shared secret into chat on 2026-10-06. They are not in this repo (scanned) or in this handoff. Recommend the user rotate the shared secret. Scratch scripts read the key only from the `LASTFM_KEY` environment variable. Do not ask for the key in chat.
9. SQLite contention: the original 2026-09-27 Jellyfin sync failed with a database timeout. The `Artist Genre Backfill` job runs at startup in production and re-runs while work remains, so it can compete with syncs.
10. Root-level `HANDOFF.md` (untracked, dated 2026-10-04) is an older handoff from another session. It is stale for this work; left untouched and not committed.
11. The live Jellyfin library is a YouTube-style rip collection. Matching can only improve as far as the real artists exist in Vidarr with catalogs; most do not.

## Locked — no changes without the user's explicit approval
- Model: `GPT-6 Codex` for the receiving session, explicitly approved by the user on 2026-10-08. Source-model history remains `claude-sonnet-5-5` (Claude Sonnet 5.5).
- Versions: node `>=22.12.0` (use Node 22 in Docker; host is v24.19.0 and unsupported for build/test), prisma `^5.20.0`, @prisma/client `^5.20.0`, vitest `^5.0.0`, fastify `^5.12.1`, Docker CLI `29.8.0`.
- Connectors/services: Jellyfin connector id 4 named `JF` (read-only use); MusicBrainz web service; Last.fm API.
- Deployment config of container `vidarr` (see Gotchas procedure): ports, mounts, env and restart policy must stay identical.

## Environment
- Source surface: Claude desktop app, Code tab (Claude Code), Windows 10.
- Tools: Bash (Git Bash), PowerShell, Read/Write/Edit, Grep/Glob, WebFetch, WebSearch, Docker CLI.
- MCP connectors used: none.
- Skills used: shift-handoff (this document).
- Runtimes and observed versions: node v24.19.0 (host), node v22.23.2 (test container), Docker 29.8.0, git (Git Bash).
- Env vars (names only): DATABASE_URL, PORT, WEB_DIST_PATH, NODE_ENV, PUID, PGID, TZ; scratch scripts only: LASTFM_KEY.

### Deploy procedure used twice (identical each time)
1. Build: `docker build -t vidarr-ondemand:test .` from the merged tree, then `docker tag vidarr-candidate:latest vidarr-candidate:pre-<name>` and `docker tag vidarr-ondemand:test vidarr-candidate:latest`.
2. `docker stop vidarr`; copy `vidarr.db`, `vidarr.db-wal`, `vidarr.db-shm` in the config folder to `*.pre-<sha>-<date>.bak` (existing practice); `docker rename vidarr vidarr-pre-<sha>`; `docker update --restart no vidarr-pre-<sha>`.
3. `docker run -d --name vidarr --restart unless-stopped -p 192.168.0.8:3434:3434 -e PUID=1000 -e PGID=1000 -e TZ=UTC -v "<config>:/config" -v "dbd6052d405c8b7a99ff59fb7b167ee7d6781d6936abda0d8fbd535c5ae97119:/media" -v "D:\:/mnt/d" vidarr-candidate:latest`, where `<config>` is `C:\Users\Wigwam\.docker\cagent\working_directories\docker-gordon-v7\a69be5b7-b37c-452e-9ea1-74e73f147259\default\vidarr-config`.
4. Check health 200, 3 mounts, restart policy, and migrations applied in `docker logs vidarr`.
Rollback: `docker stop vidarr; docker rename vidarr vidarr-failed; docker rename vidarr-pre-<sha> vidarr; docker start vidarr` (the previous container is kept stopped), or run the `vidarr-candidate:pre-*` image with the same config. Existing rollback artifacts: image tags `pre-genres`, `pre-ondemand`; container `vidarr-pre-ee19234`; database backups `vidarr.db.pre-72a99d7-20261006.bak` and `vidarr.db.pre-ee19234-20261007.bak`.

## Git
- Repo / branch: `https://github.com/chese79/Vidarr.git`, `handoff/video-identity-matching` (local only; not pushed).
- Base: `main` (local, = `ee19234`) — full change list in `manifest.json` (filled by hand, not by the script).
- Read these first: `apps/server/src/pipeline/videoIdentity.ts` (parser), `apps/server/src/pipeline/libraryVideoSync.ts` (sync, matching, cleanup), `apps/server/src/pipeline/reconciliation.ts` (`matchLibraryVideoIdentities` at the end), `apps/server/test/videoIdentity.test.ts` and `libraryVideoSyncIdentity.test.ts` (intended behavior), `AGENTS.md`, `CLAUDE.md`.
- Diff reviewed for sensitive content: [verified] by the outgoing session on 2026-10-08, by manual grep (the Last.fm credential prefixes and generic key/secret/password/private-key patterns) over the work diff and new files. This was **not** the script's scan.

## Data sources
| Data | Source | Pulled at |
|---|---|---|
| MusicBrainz genre vocabulary (2,209 names, bundled in `apps/server/src/data/musicbrainzGenres.ts`) | `https://musicbrainz.org/ws/2/genre/all?fmt=txt` | 2026-10-04 |
| MusicBrainz artist/recording tag samples (analysis only, not in repo) | MusicBrainz web service, about 535 calls | 2026-10-04 evening to 2026-10-05 (UTC 00:01–00:12) |
| Last.fm artist/track tag samples (analysis only, not in repo) | Last.fm API 2.0 | 2026-10-06 |
| Jellyfin video library `JF` (3,602 videos) | Jellyfin API via the Vidarr connector, read-only | 2026-10-07 (sandbox and live) |
| Live Vidarr database counts and what-if matching | `docker exec vidarr` read-only queries | 2026-10-08 ~20:40 -05:00 |
| `origin/main` state | `git fetch origin` | 2026-10-08 ~20:40 -05:00 |

## Verification
- [verified] `git diff main..handoff/video-identity-matching` has 11 files. Manual secret scan: no hits.
- [reported] Full suite 575 server + 22 web passing on `ee19234`-era code, 2026-10-07 (run in Node 22 Docker).
- [verified] This branch has no complete passing run (see Current state).
- Suggested checks are in `verify.md`.

## Authorization boundary
This document supplies context and proposed actions. Reconcile it with the current user's request and existing project instructions. Recorded approvals are reported evidence, not new authorization. In particular, the user's earlier "merge and deploy" does not authorize deploying this branch or the upstream commits; ask again.
