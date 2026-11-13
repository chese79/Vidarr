# Library artist navigation and identity review

The 2026-11-04 navigation revision includes unresolved artist observations in Music Videos and
Live & Concerts. Their rows display **Unconfirmed** with an Artist Review link, and their initial
letters participate in the alphabet rail. Both identity states share displayed-name sorting,
leading-article handling, search, pagination and genre filtering. Linked observations stay hidden
because their canonical owner already represents them.

Music Videos' empty-artist setting hides rows only when available, known and unmatched video
counts are all zero. Live retains artists without music videos. Server videos without a reviewed
catalog match remain unmatched inventory; row visibility does not establish confirmed catalog
availability. Expanding an unconfirmed row explains identity review instead of mounting catalog
discovery or Live controls.

Artist identity now follows the 2026-11-07 automatic acceptance policy: validate and accept the
highest-ranked match at 82% or above and start source collection, including saved legacy ambiguous
proposals. A close runner-up no longer requires a click. Below-threshold identities and conflicting
catalog ownership retain review; uncertain-video review, validation, import and delivery remain.
Visibility
does not rewrite artist IDs, merge observations, change monitoring preferences or create videos
or performances.

Library genre filters use genre statistics without loading the complete artist catalog on entry.
The legacy artist-list fallback runs only if statistics fail. Paged summaries and active web-request model
reads use a reserved two-connection reader pool alongside the background/writer connection; transactional reads
remain inside their transaction. No cached credential/identity results are introduced.
Accepted artists queue source collection automatically, with at most two collections running.
Waiting state persists for restart recovery through the existing source backfill.

## Interrupted-sync recovery evidence

On 2026-11-04 Yo La Tengo's inventory was present, but its artist remained unmatched. No confirmed
Y artists existed, which previously disabled Y in both views. The connector's saved failure
records a database timeout during artist creation. Its audio observation already held MusicBrainz
ID `3f542031-b054-454d-b57b-812fa2a81b11`.

Recovery verified that ID on the current Jellyfin MusicArtist, checked for a canonical owner and
saved a private before-state snapshot. Existing identity enrichment validated MusicBrainz and
confirmed the artist. Production summary responses enabled Y in both views and reported 283
unmatched server videos. Those records were preserved without automatic official/live
classification. This recovery does not clear the historical failed-sync status or claim the
underlying database timeout is resolved.

The navigation revision exposes other unconfirmed observations, so interrupted identity resolution
no longer makes observed artists disappear. Regression checks cover letters backed by unmatched
inventory, empty-row filtering, failed identities, linked-row exclusion, pagination and review-only
expansion in both media views.

## Verification and local deployment

The Node 22 Docker production build succeeds. Ten focused UI checks pass; eight checks were
repeated successfully after the final monitoring/selection safeguards. The API suite passed 49 of
50 initially; one existing count test exceeded its five-second limit under load. That test and
the new unconfirmed-navigation regression passed on targeted rerun with a longer timeout.

The rebuilt local image is `vidarr-unconfirmed-artists-20261104:local`; only Vidarr was replaced.
Its exact four mounts, environment, port binding and startup command were retained, and the prior
container is retained as `vidarr-before-unconfirmed-20261104` for rollback. No configuration volume
or media was removed. Production checks confirm healthy status, served bundle `index-EqPTBk_l.js`,
Y navigation/Yo La Tengo in both modes, one unconfirmed Y row in Music Videos and five in Live.
Configuration fingerprints and all original artist/video/playlist IDs are preserved. The first
cold-start API verification timed out; subsequent actual endpoint checks passed. Independent
summary-query timings were under one second each once startup/build work settled.

Private fingerprints, container state and reports are retained under the ignored MTV-plugin
`.artifacts` directory. To roll back, stop the replacement, rename it aside, restore the retained
container's `vidarr` name and start it; retain the shared configuration/media mounts throughout.

## Search, actions and playlist navigation (2026-11-12)

Artist summary statistics are scoped to base-filtered artists and the selected letter before
aggregation. The alphabet rail independently checks base artist presence; count refinements do
not shrink it. MusicVideo(artistId,catalogKind) and LibraryVideo(musicVideoId) indexes are additive
Prisma migrations. Unmatched names use a set predicate so duplicate artist names cannot multiply
counts. Superseded browser summary requests are aborted.

Single monitoring acknowledges its saved flag and persisted pending source check before provider
work. The bounded collector retains errors and retry state; bulk updates commit in one chunked
transaction. Saved flags update locally before background summary refresh completes.

Playlist Manage video links include artist and video IDs and open the existing artist controls.
The artist row is focused once after data arrives and highlighted by the URL fragment. Polling
does not repeatedly move focus. A new navigation can target another video; same-title entries
remain distinct. Live entries use their recording page, or the Live artist library for legacy
classified entries. Missing identity data does not produce guessed links. The additive optional
artist ID in the playlist item contract preserves legacy payload compatibility.
