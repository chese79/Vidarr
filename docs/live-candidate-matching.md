# Live candidate matching and acquisition

Live video discovery automatically queues MusicBrainz and setlist.fm checks when a video is added.
The `Live Candidate Matching` task also backfills existing eligible candidates. It prepares up to
50 candidates and attempts up to five provider checks per minute, with a persisted ID cursor.
Restart resumes pending checks; overlapping task runs share a guard. Ignored, deleted, rejected,
returned-to-Music-Videos and duplicate recordings are excluded. No matching job starts a download,
creates catalog performances or accepts recording sources. General Live enablement/capability
controls the task. Changes to title, source identity or canonical artist invalidate stale reports.

Reports use separate `LiveSearchJournal` keys per candidate/provider. Source rescans preserve
reports and operator dismissals. This uses existing storage and requires no schema migration.
The Live index shows completed, pending and retrying **provider checks**, not matched artists.
Checks retry incomplete/provider failures after 30 minutes. A completed bounded check is retained
until its identity changes or the user requests another check. Backfill is gradual, not an
instantaneous assertion that the full library has been searched.

## Scope and evidence

MusicBrainz checks up to 100 Live release groups, 100 direct performer-event relationships,
three relevant event details, and ten recording search results for a claimed song. Related event
details must retain the canonical artist's performer relationship. Release dates are never used
as performance dates. Results are cached for one day, requests share the serialized 1.1-second
transport, and matching permits up to 1,000 uncached provider calls per UTC day.

setlist.fm checks one bounded artist page, scoped to an explicitly claimed full date or year when
present. It uses the existing daily 1,000-request budget, shared serialized transport, one-day
cache and authentication/cooldown controls. History traversal beyond that page is explicit via
`Check next setlist.fm page`; the report displays checked scope and remaining pages. This changes
the former strictly-on-request policy for candidate checks only. General history traversal and
the old metadata monitoring job remain on request/inert respectively.

The provider APIs used are documented by [MusicBrainz search](https://musicbrainz.org/doc/MusicBrainz_API/Search),
[MusicBrainz relationship lookups](https://musicbrainz.org/doc/MusicBrainz_API/Examples) and
[setlist.fm](https://api.setlist.fm/docs/1.0/index.html). setlist.fm taped tracks are excluded from song agreement.

The right-hand vertical fields are Artist, Song(s), Performance date, Venue, City/location and
Event/session. Each known value retains its source, link and basis: library identity, unverified
upload-title claim, or reference whose association with this upload is unconfirmed. Multiple
sources and differing values remain visible. Unknown fields stay unknown. A YouTube publication
date or album release date cannot fill the performance date.

Exact artist, full date, venue and claimed-song agreement produces a strong **event reference**
match. Partial event agreement is possible; song agreement alone is song-only and supplies no
event/date/location facts. Contradictory known fields with event agreement produce a conflict;
equally scored distinct events are ambiguous. A song reference never proves this capture, moving
video or complete coverage. No match means no match within the displayed query scope. Pending,
not checked, unavailable and failed are separate states; provider errors never imply absence.

## Review, delivery and recovery

Actions appear in this order: setlist.fm match, MusicBrainz match, magenta Confirm and Grab, Ignore.
Both provider reports are checked independently. Protected thumbnail requests use the candidate's
fixed YouTube identity; missing artwork keeps a placeholder. Search, pagination, expansion and
thumbnail loading cannot accept a source or enqueue media.

Confirm and Grab opens explicit performer/occasion, actual moving-video and exact-upload review.
Conflicting/ambiguous references require acknowledgement before independent confirmation.
Coverage is a claim, not verified completeness. Confirmation reuses normal recording review and
source acquisition, preserves exclusions and requires a configured Live destination. It creates
or reuses an independent recording/performance with unknown date/location rather than silently
merging reference identities. Compilations with multiple linked performances use full recording
review. Existing owned recordings/active downloads prevent duplicate submission.

Success returns to the same discovery position with a queued acknowledgement. Media validation,
import, delivery and exact playback-server catalog confirmation remain required; queued does not
mean available. A late acquisition failure retains review so the user can correct settings/source
availability and retry. Ignore persists across rescans without deleting media or cancelling an
existing transfer, and is refused while confirmation is in flight. Provider failures retain prior
reports and expose retry information; manual match actions can retry before the scheduled pass.

## Verification

Node 22 Docker production builds pass for shared types, server and web. The 51 relevant backend
checks cover matching confidence, provider failures, durable bounded backfill, confirmation and
existing recording-review/API behavior. All 89 web tests pass, including source attribution,
action ordering and required confirmation checks. A 30-second timeout accommodates the backfill
test's real 50-candidate SQLite batch on the local Docker host. Native-browser visual acceptance
remains a manual check; the test suite verifies rendered controls and interactions.
