# Live starting inventory

## Automatic candidate evidence (2026-10-27)

New and existing eligible video candidates receive bounded MusicBrainz and setlist.fm checks.
The approved gradual backfill, source-attributed fields, status flags, protected thumbnails,
Confirm and Grab review and recovery are documented in [Live candidate matching](live-candidate-matching.md).
This supersedes the original on-request-only candidate lookup policy described below; general
history traversal still requires an explicit request and metadata monitoring remains inert.
Video actions are visible beside the vertical evidence fields; reference search leads keep their
expandable review/search flow. Matching alone never accepts sources or submits downloads.

## Candidate display (2026-10-27)

Artist Live discovery uses the same compact `artist-row`/expandable review pattern as music-video
candidates. Videos and MusicBrainz reference leads have separate counts and 25-row pagination,
sharing a bounded artist-scoped title search applied before counts/pagination. The endpoint keeps
its existing five-item default for older callers; the UI explicitly requests 25. Expand a row for
source provenance and match scope. Video rows show source-attributed fields and review actions;
reference rows retain the existing review/search or dismissal action.
Expansion is a read-only presentation action. Unknown occasion details remain unknown, and neither
search nor expansion accepts a recording or submits a download. Loading, empty results and failed
requests have distinct states; failed reads offer retry without discarding prior discoveries.

Live monitoring fields use compact 14px controls: tour up to 20rem, dates 12rem, daily budget
5rem and vertically arranged selectors up to 15rem, retaining the right-side panel layout and
stacking safely on narrow screens.

An operator-requested existing-artist source pass is persisted in the existing search journal,
including a snapshot of confirmed artist IDs, cursor, current artist and failed attempts. The
`Existing Artist Source Discovery` task processes one artist per pass, continues while work
remains, and resumes after restart. It is inert until explicitly seeded; new artists cannot
silently expand a running batch. The Live starting view shows attempted/total and retry counts.
This collector uses shared sources with IMVDb/local traversal disabled and submits no downloads
or setlist.fm lookups. Existing monitoring preferences are never rewritten.

The [approved request](requests/2026-10-23-live-starting-inventory.md) separates useful discovery
from accepted catalog/ownership. `LiveDiscoveryItem` retains artist-scoped provider IDs, title,
source URL/evidence, ranking, dismissal and explicit promotion links. It is not a performance,
recording source acceptance, file, download request or claim that a video exists. The additive
migration preserves existing media, IDs, review decisions, configuration and setlist history.

`Settings.liveEnabled` defaults true for existing Full installations. The General Library checkbox
controls background collection and new Live source/reference searches; existing data remains.
`VIDARR_LIVE_COMPONENT=disabled` is an independent installer/runtime capability switch. General
settings exposes availability read-only and disables activation when unavailable. It does not
implement a separate physical component-free bundle or alter the documented future Slim/Full
validation editions. Disabling discovery does not cancel already running transfers or remove files.

The shared YouTube scanner stages explicitly live/concert uploads before applying MV exclusions,
using original source IDs and discovery origins. Trailers, backstage/interviews, lyrics/audio and
other strong non-performance title signals are not starting videos. Artist/content uncertainty
still requires review; source-channel membership is not proof of performer identity. Historical
pending observations and automatic `Title indicates live...` rejections can seed the Live list;
manual MV rejections are preserved and not resurrected by this backfill. Independent Live
dismissals and linked recording review outcomes survive rescans. Scan exclusions remain effective.

MusicBrainz queries a bounded website-default Live release-group page and direct performer-event
relationships. Live albums rank first, then broadcasts and selected event references; all reference
facts remain evidence. The UI shows 25 references per page; older API callers default to five. Collection
never creates a performance for every reference and never imports an artist audio discography.
The initial implementation does not auto-match recordings to events or adopt research-only
triangulation rules. Normal review remains responsible for that association.

The existing source collector prepares Live inventory after shared channel collection, independently
of browser mode. A one-minute job backfills three confirmed artists per pass, prioritizing saved
Live upload observations and then newest artists;
successful preparation is tracked separately from MV source progress. Partial failures retain
previous items and retry after ten minutes. Interrupted `running` preparation becomes eligible
after the same cooldown. Simultaneous preparation for one artist shares one in-process task.
Manual refresh may retry immediately; the MusicBrainz transport remains serialized/rate limited.
Live entry provides a bounded warm-up; manually opening an artist queues its shared channel
collection if needed. Neither action consults setlist.fm.

`GET /live/start` returns up to five artists with discoveries. Artist `/start` reads accept a
video/reference kind and bounded offset/limit (default five, maximum 25). Readiness is displayed
separately from discovery counts and source errors. `POST /artists/:id/prepare` acknowledges
background work with 202; the UI polls progress and progressively shows results. Explicit refresh
uses `refresh: true`. Dismissal hides only that discovery, preserving it in storage.

An explicit `/start/:itemId/open` transaction creates or reuses pending normal review/search
identities. Exact source ownership in another artist/catalog blocks promotion for classification
review. Repeat activation reuses the same recording/performance. A MusicBrainz release date and
a YouTube publication date never become performance dates. An upload with unknown occasion may
remain independent; normal actual-video/artist review precedes acquisition, and existing validation,
import, and target-server delivery outcomes remain mandatory.

setlist.fm is only accessed through explicit artist history-page/manual reference-link actions.
The old `Live Event Metadata` scheduled entry point is retained for task identity compatibility
but performs no requests, cursor advancement or ingestion. Active monitoring rules search only
saved selected performances. Credentials and historical references/cursors are not erased.

Source migration and updated application outputs are deployed together using the established
configuration backup and Vidarr-only recreation process. Media and staging mounts are preserved.

## Local build verification — 2026-10-23

Node 22 server/shared-types/web production builds pass. The complete server suite passes 902
tests across 116 files; all 75 web tests across 20 files pass. A final 36-test focused pass
also verifies the last warm-up-priority and rejected-recording-visibility safeguards. The additive
migration is checked against a populated fixture, retaining configuration, media and review IDs.

Built image: `vidarr-live-start-20261023:local`, identity
`sha256:319a79b7bbdfbf2e4168a2774c145dc27057666c21321802402441ef43aaa40a`.
The local build reuses the verified Full media-tool runtime with unchanged production dependencies
and fresh Prisma/server/web/shared-type outputs; the canonical Dockerfile remains unchanged.

An offline built-image test using cached Adele observations finds 28 retained video candidates and
16 fixture reference leads, returns five of each initially, creates no automatic performance rows,
and enters unverified pending review only after explicit opening. Downloads/setlist.fm requests
remain zero. Disabling Live preserves the discoveries. The separate live MusicBrainz contract
check returns five official Live release groups and 15 performer-event references for Adele.
No production configuration/media mounts are used by these tests.

## Local deployment and requested population — 2026-10-23

Deployed `vidarr-live-start-20261023:release` (image identity
`sha256:81b813ca4bafdfa6cf677d4115326f9b141b9c10dad3f8e544eda9180bbf6991`)
to the existing local address. The compact controls measure 31–34 pixels tall; tour/date/budget
widths are capped at 320/192/80 pixels and right-side selectors at 240 pixels. Narrow layouts stack.
The additional queue/UI changes pass 41 focused server tests and all 75 web tests, production
builds, and the offline built-image smoke check.

The service is healthy. Backup volume `vidarr-backup-20261023-live-start-compact` and stopped
rollback container `vidarr-rollback-20261023-live-start-compact` retain recovery material.
All original artist, video, queue, review, file, Live, recording and playlist IDs were verified
against the backup, as were original settings, Live configuration and root folders. All mounts
were retained; SABnzbd was unchanged. Never remove or overwrite these volumes during source updates.

The explicitly requested batch snapshots 802 confirmed artists. The remaining 2,249 artist
observations require identity confirmation and are excluded. Population continues in the running
service; its durable status is shown in Live and at `/api/v1/live/source-refresh-status`.
A started batch is not a completed provider check: inspect attempted/remaining/failed counts.
setlist.fm remains on request, and this batch does not submit downloads.

### Catalog color deployment — 2026-10-23

`vidarr-catalog-colors-20261023:release` adds logo-based pale-yellow Live and magenta Both
palettes with blue borders; embedded Live panels inherit the Both palette. Shared utility pages
remain neutral. All 76 web tests and Node 22 production builds pass. Text/button contrast
exceeds 4.5:1 and blue borders exceed 3:1 against both elevated surfaces.
Backup: `vidarr-backup-20261023-catalog-colors`; previous container:
`vidarr-rollback-20261023-catalog-colors`. Vidarr alone is recreated, preserving mounts and the
durable existing-artist discovery batch. The default-open discovery-panel request remains deferred.
