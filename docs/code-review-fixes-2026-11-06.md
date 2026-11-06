# Review corrections — 2026-11-06

The full static review identified twelve actionable defects; broader web validation exposed
one additional Live component-state defect. The correction set preserves
identity review, source validation, delivery confirmation and native conditional writes.
It also completes the pending enrichment throughput work documented in
[metadata enrichment](metadata-enrichment.md).

| Area | Correction and recovery |
| --- | --- |
| Local media bundles | Import and MV/Live deletion share exact-stem metadata/artwork and recognized subtitle variants. A longer sibling video stem owns its companions. Existing deletion plans are rechecked before remote or local removal; ambiguous plans fail for review. |
| Motion inspection | A failed or terminated FFmpeg decoder rejects inspection; absence of freeze messages is evidence only after successful decoding. |
| YouTube source authority | A channel-name/VEVO search heuristic remains heuristic after motion acceptance. Historical `youtube-search` observations use additional-source validation even if older rows say verified. Official channel/source evidence retains its existing policy. |
| Enrichment compilation | Previous provider context must exist before completed evidence can be reused. |
| Provider retry | Retry reserves the same exclusion lock as the worker and manual application through all rewinding writes. A running item rejects retry with the existing pause/wait recovery message. Pause/cancel still finish the current item. |
| Torrent import | Completion requires a recognized upload/completed state and progress exactly one. Paused downloads, startup checks, moving and unknown states retain their queue reservation instead of importing. |
| Jellyfin playlists | Retained IDs must still be MusicVideo items in freshly enumerated selected-library membership. A scope/type mismatch fails before replacement; the old playlist remains. |
| Native MTV completion | Metadata snapshots and completed request replays require both valid owned ASS bytes and a registered owned subtitle stream. Missing registration reports incomplete; a fresh guarded request can register the unchanged owned track. Plugin release is 0.1.5. |
| Enrichment review UI | Changed proposals or metadata fingerprints recreate the review selection and consent. Evidence selection resets selected fields and correction consent; invalid indexes cannot render a row. |
| Partial-provider fixture | The recovery test explicitly persists the IMVDb ID so a director outage and its retry actually execute. |
| Artist name lookup | Bounded joined/spaced variants are merged by MusicBrainz ID; irrelevant spaced-name results cannot suppress the original spelling. |
| Homonymous videos | Multiple exact artist-name/title matches remain ambiguous instead of confirming the first catalog row. |
| Live component state | The broader web suite exposed duplicate artist-ID keys on discovery, starting inventory and the add form. Their keyed artist-page parent already handles artist changes; redundant child keys are removed to keep sibling state separate. |

No Prisma schema change is needed: optional proposal state remains backward-compatible JSON.
No configuration volumes or media files are replaced by application deployment. Untracked
research remains outside the commits. Merge and release require Node 22 server/web builds,
automated regression tests, native plugin build/tests, and production preservation/health checks.
Build success does not claim full-library enrichment completion or physical Roku verification.

The extra Live playback investigation found that the shared-device time cap already applies
before song credit. Its existing regression now also asserts song credit, without changing the
working accounting logic.

Verification so far: Node 22 server and web builds passed. The native Jellyfin 12.3/.NET 10
build passed without warnings and all 64 core tests passed. Twenty-five isolated API checks
passed, including removal of the synthetic stream registration while retaining identical ASS
bytes/fingerprint, refusal of completed replay, fresh targeted registration recovery, unchanged
video bytes/mtime and untouched other tracks. Native DLL SHA256:
`d198ede8bba6e82f031b61922512cc90a10e31988b25a7c0d9f7f26590bfa7fd`.

All 172 focused tests across 20 files passed on Node 22/Linux, including the UI regression and
partial-provider write/retry recovery. Seventy-one pure/provider checks also passed on portable
Node 22/Windows; its UI worker lacked a host jsdom dependency and is covered by the passing Linux
run. The first 50 broad artist API tests passed before the slow full run was stopped to move its
disposable database onto a 128 MiB tmpfs. This changes only test storage, not production settings.
The complete suite covered 984 tests in 129 files: initially 968 passed and 16 failed in four
outdated fixture files. After updating typed/scoped Jellyfin responses, selected-library inventory
and the already-approved unconfirmed-artist expectation, all 66 tests in those four files passed;
the other 125 files were unchanged and passed. The final application image passed server/web
builds and an isolated Node 22.23.2 runtime check of the compiled sidecar and retry-control paths.
Release image: `vidarr-review-20261106:release`, OCI manifest list
`eec188a791d678c6272761f5bdbc68692b5bbc066773bbe0daa1d51444fb883c`, web bundle
`index-ZojK4P5L.js`. All 95 web tests across 23 files passed, including the additional Live
component-state regression. The server bundle is unchanged from the original twelve-finding
release. Application replacement and enrichment resumption remain separate checks.
A temporary Dockerfile serializes the unchanged server/web build stages on this 8 GB host by
using `FROM build-server AS build-web` instead of `FROM base AS build-web`; it changes no runtime
dependencies, application source or deployment mounts. The user requested waiting for
Roku playback to stop before the native plugin restart. After an idle recheck, MTV 0.1.5.0 was
installed and native Jellyfin 12.3.0 returned healthy with its original server identity. The
active plugin version, metadata capability 0.1.5 and an existing real owned stream were verified
read-only. Settings, connector configuration, playlists, native library/plugin configuration and
subtitle defaults passed the preservation hash check. The prior plugin folder is retained.
No new physical Roku playback test is claimed. The preservation snapshot holds 14
playlists, 3,052 artist IDs and 7,287 video IDs; later background additions are allowed. Batch 2
settled after its current item at 969 checked, 19 changed, 596 review and 373 failed, with queued follow-up retained.
Pause is temporary deployment preparation, not a claim of enrichment completion.

A fresh stopped-service database/WAL/SHM/journal recovery bundle was saved inside
`/config/operator-recovery/review-before-20261106/database/`; service was restored before its
Linux working copy passed `PRAGMA quick_check`. The private `verified.json` marker records success.
Configuration/media volumes were retained. Host Node 24 was not used to execute application tests;
the portable Windows fallback was checksum-verified Node 22.23.2 and does not replace system Node.
