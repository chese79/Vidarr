# Concerts and live performances

Date: 2026-10-17  
Status: Product rules and all three UI previews approved; implementation is not authorized by this document.  
Scope: Consolidated user decisions, observable requirements and remaining design questions.

## Design review outcome

The user approved the monitoring setup, match/classification review and playback/chapters/resume
previews. There are no further planned product-rule questions or UI approvals in this design
round. Remaining work is technical verification and implementation planning, as listed below.
If that investigation exposes a material product tradeoff, return it for review rather than
silently changing an agreed decision. Approval of the design does not authorize feature code,
database migrations, external publication or deployment.

The user subsequently authorized the audit, shared model, migration plan and behavior-preserving
foundation refactor in [backend alignment](../backend-alignment.md). That limited authorization
does not enable live workflows or apply the future recording/asset migration.

## Objective and current boundary

Extend Vidarr with a video-only live catalog sharing its existing MusicBrainz artist identities.
A concert is analogous to an album; its individual song performances are analogous to tracks.
Unlike an artist's relatively bounded music-video catalog, live history can contain thousands
of events plus informal performances. Discovery and completeness must account for that scale.

This is a future design. Current music-video exclusions, the label-only Flag as Live/Concert
action and existing qualified-play thresholds remain in force until separately approved code
implements this specification. No code, schema migration, provider configuration or deployment
is part of this documentation change.

## Agreed domain and authority

| Concept | Meaning and relationship |
| --- | --- |
| Artist | Reuse the MusicBrainz-confirmed artist identity shared with music videos. Retain participating artists and roles. |
| Song | The musical composition, optionally identified by a MusicBrainz Work. It can have many different live performances. |
| Song performance | A particular rendition by artist(s), at a place and date/time to the precision known. It may stand alone or be ordered alongside adjacent songs. |
| Grouped performance | A concert, session or other occasion containing an ordered set of song performances. A festival occurrence groups separate artist performances. |
| Recording | A particular video capture/edit of one or more song performances, including a full concert. Multiple recordings may capture the same performance. |
| Source | A provider item, URL or existing file supplying a recording or identity evidence. A different URL does not by itself mean a different performance or recording. |
| Ownership and availability | Owned files, confirmed playback-server copies and external download availability are distinct facts. |

Do not use artist + song title as a performance identity. The same artist performing the same
song on two dates produces different song performances. Unknown place/time details must not
force unrelated discoveries into one identity. Exact identifier and deduplication rules remain
an implementation-design question below.

MusicBrainz supplies artist identity and supporting song, recording, place and event identities.
Setlist.fm is the canonical event/setlist reference where a matching entry exists. Neither
service's absence invalidates an independently evidenced Vidarr performance. A canonical
event does not prove a recording exists, has video, depicts that event or is complete.

Preserve per-source evidence and external IDs independently of Vidarr's own identities. A
MusicBrainz recording ID and an external URL are optional references, not mandatory local keys.

## Classification: independent dimensions, not six exclusive categories

The earlier list of full concerts, live songs, festival sets, television appearances, studio
sessions and acoustic sessions is superseded by these independent dimensions:

| Dimension | Agreed values |
| --- | --- |
| Setting | Concert; festival; television/radio; studio session; informal gathering |
| Style | Acoustic; electric; mixed; unknown |
| Recording coverage | Entire performance; several songs; individual song; excerpt |

One performance may appear in multiple filtered views without duplicate entries. Apply
attributes at the appropriate level: an acoustic section can sit within an otherwise electric
concert. Full concerts, individual live songs, festival sets, television appearances, studio
sessions and acoustic sessions all remain supported use cases. Radio appearances are eligible
only when an actual video recording exists.

Festival occurrences group separate artist performances. Opening acts retain their own ordered
sets linked to the same concert occasion. Credit guests on the song performances they joined;
do not duplicate the performance under each guest artist.

Audio-only recordings are excluded, including official releases and static-image audio uploads.
Adding audio-only acquisition would require a separately approved future feature. Audio-related
metadata may corroborate identity without making the audio recording eligible for acquisition.

## Discovery, matching and review

### Sources

Accept existing local files and Jellyfin/Plex inventory, official artist channels,
broadcaster/festival channels, other YouTube/Vimeo uploads and configured indexers/download
clients. Indexers are an active discovery/acquisition route for live material, not merely a
rare fallback inherited from the music-video workflow.

Both professional and audience video recordings are eligible and must be clearly labeled.
Source reputation alone never bypasses performance identity or content validation. Detailed
source trust details remain open. Direct uploads and indexer results compete under the same
recording-quality priorities: completeness, audio quality, visual quality and resolution.
Users may prefer particular sources; official origin does not automatically outrank a better
eligible recording. There is no fixed source-type ordering that makes indexers a last resort.

For indexer releases containing multiple concerts or unrelated files, identify eligible
recordings and download only selected files when the client supports selective downloading.
If it does not, present the full download size and contents for approval before acquiring the
pack. Never automatically import unrelated files. Unknown pack contents/capabilities must not
be treated as proof of selective-download support; their fallback needs capability review.

### Required flow

1. Discover a video/file/release candidate and retain its original metadata and provenance.
2. Extract known artist, song, place, date/time and adjacent-song/order evidence.
3. Resolve MusicBrainz identities and use available relationships to narrow candidate events.
4. Compare the evidence against setlist.fm and supporting sources.
5. Automatically confirm only when all of the following agree: confirmed artist, exact
   performance date, matching venue and the song's presence in the event setlist, with no
   conflicting evidence.
6. Send missing/conflicting date or venue evidence, multiple possible events, and matches
   inferred mainly from adjacent songs to review. Adjacent songs help narrow candidates;
   they do not independently authorize automatic confirmation.
7. If no suitable external event exists, retain an independent Vidarr entry, its evidence,
   unknown fields and review state. Link it later when an appropriate external entry appears.

Metadata agreement establishes identity; it does not bypass the selected recording's content,
source, quality or acquisition checks. An independent entry is usable without a setlist.fm
match, but uncertainty is not silently promoted to confirmed identity.

Match review shows discovered video evidence beside candidate events, highlighting matching,
missing and conflicting details. Actions are Confirm match, Choose another event, Keep
independent, Edit details and Reject candidate. Bulk confirmation is restricted to candidates
meeting the automatic-match rule; uncertain candidates remain individually reviewable.

Keep known date/place precision: year only, city without venue, or date without time are valid
stored observations. Leave unknown components unknown. Store upload and broadcast dates
separately from performance dates. Later evidence may refine an entry; conflicts require review.

### External corrections

Refresh externally managed MusicBrainz/setlist.fm metadata while preserving user edits. If an
external correction conflicts with a confirmed artist, date, venue or song match, flag it for
review and retain the existing recording association until resolved. A provider refresh must
not silently relink recordings or overwrite a user's correction.

Setlist.fm submission assistance is deferred, including proposed submission drafts. Independent
entries remain usable. No automatic submission is authorized. Some informal/private performances
are outside setlist.fm eligibility and may remain local permanently.

## Monitoring, states and scale

Monitoring can target individual performances, tours or artists, with optional date/year limits.
It authorizes automatic searches and acquisition under saved source, quality and validation
settings. Newly discovered entries start unmonitored; membership in an existing monitoring rule
must be explainable rather than silently monitoring all history.

| User-visible condition | Agreed meaning |
| --- | --- |
| Missing | Monitored; a confirmed eligible video recording is known to exist; no recording is owned. |
| Partial | Some song/section coverage is owned and additional known coverage is missing. |
| Recording unknown | An event is known, but no eligible video recording has been found. Exclude it from missing totals. |

These are observable conditions, not a prescribed single database enum. Monitoring, identity,
coverage, ownership and availability can vary independently. A library must not appear incomplete
merely because an artist has thousands of historical performances without known video recordings.

### Monitoring safeguards agreed during design review

Before activating broad artist/tour monitoring, preview matching performances, known recordings
and estimated searches. Estimated search volume is a required part of this preview, with a range
and explanation of uncertainty where provider results are unknown. Let users narrow dates,
settings and recording types before activation. Run work in bounded batches with pause/cancel
controls; empty-result searches must not repeat without backoff.

Provide configurable daily budgets per artist/tour within global provider limits. Preview the
estimated first-pass search volume and the number of days the selected budget would take.
Reaching a budget defers unfinished work to the next window instead of discarding it. Estimates
must communicate uncertainty rather than promise a fixed completion time.
Default daily budgets are 50 provider search requests per artist/tour and 500 globally,
configurable and always subject to lower provider limits.

Count each actual provider search request, including additional result pages, as one search.
Cached results consume no search budget. Show metadata lookups separately while respecting
their provider rate limits. Deduplicate work across overlapping artist, tour and individual
performance rules: search the same performance once, show shared work in estimates, and keep
it monitored until all applicable rules are removed or disabled. Charge a shared request once
globally and once to its initiating rule; other matching rules reuse the result without a
second charge. Schedule work fairly across active rules so one large artist/tour cannot
monopolize the global budget.

Newly discovered performances inherit an active artist/tour monitoring rule when they match
its date, setting and recording filters. Explain which rule activated monitoring, include work
within its budget, and allow explicit individual exclusions. Entries outside active rules
continue to start unmonitored.

Fetch candidate events around a discovered video's known dates first. Broader artist/tour
history loads progressively in pages within the selected scope, with a visible Load more action.
Adding an artist must not automatically import their entire event history. Page/batch sizes,
estimate sampling and the division between manual browsing and background scoped fetching
still require concrete interface design.

After empty searches, progressively lengthen retry intervals. A user-triggered Search now action
or new evidence, such as corrected event details or a newly linked source, can make a performance
eligible sooner while still respecting budgets. Default empty-result delays are one day,
then seven days, then 30 days, then recurring 90-day intervals after successive empty searches.
Provider errors use separate failure recovery and do not count as empty results.

Retain owned, explicitly monitored, user-edited and review-pending entries until the user removes
them. Unmonitored discoveries with no recordings expire after 90 days without meaningful new
evidence by default, configurable in settings. Repeated scans with unchanged information do not
reset expiry. Retain
lightweight last-search/retry information long enough to prevent repeated rediscovery and empty
searches for the same candidates. This retention rule does not authorize deleting media files.

Retain lightweight search history for one year after the last search by default, configurable.
Keep only enough identity/outcome/retry information to recognize a candidate and honor retry
timing rather than retaining its full discovery record. Deletion exclusions are independent
and do not expire under this search-history policy.

Back off temporary provider failures and respect provider-specified retry delays. Authentication
failures pause that provider until corrected; other providers continue. Show an actionable
failure and retry control and preserve existing data. Errors are not empty results and must
not be reported as no recordings found. Exact failure-backoff timings remain to be specified.

**Still open:** concrete history page/batch limits, estimate sampling, response-cache lifetimes,
exact failure-backoff timings and the detailed UI. Do not silently choose unlimited history or unbounded
negative searching. Resolve these details before broad monitoring implementation.

## Recording versions, coverage and preference

Retain distinct useful versions such as an official broadcast, audience capture or alternate
camera. Designate a preferred recording for playback and deduplicate identical uploads. Preserve
unique song/section coverage during replacements and upgrades.

Automatically deduplicate only verified identical files or the same provider item. Similar
titles, durations or event matches only suggest duplicates for review. Alternate cameras,
edits and differing coverage remain separate versions rather than collapsing by event identity.

A video compilation spanning several events stays intact. Link identified timestamped sections
to their respective performances; unknown sections remain reviewable. Do not label the whole
compilation as one concert or split it into clips without an explicit user action.

Keep original files intact. Link multipart recordings and individual song videos in performance
order. Full-concert files, parts and song videos may jointly establish coverage. File merging is
optional, not required to recognize or play a performance.

Confirm complete coverage only when every expected song is evidenced as present. Otherwise show
partial or unknown coverage as appropriate. Do not equate the presence of an event setlist with
proof that an uploaded file contains it.

Complete song coverage and a complete concert recording are separate states. Separate videos of
every song can establish complete song coverage while the collection still has no complete
concert recording. Excerpts do not establish complete-song coverage; uncertain boundaries remain
unknown. A clip collection must not be labeled an uninterrupted full concert.

When the reference setlist is incomplete, show All known songs covered; setlist completeness
unverified rather than asserting complete coverage. If new evidence adds songs, recalculate
coverage and explain the change without removing owned recordings. Never invent missing songs
from another show. Empty/incomplete references cannot justify a complete claim. The rules below
define musical and uninterrupted coverage; how their evidence is verified remains open.

Follow documented performance order. Encores remain sections of the same performance;
repeated songs are separate occurrences, and medleys link to their component songs. A snippet
or medley component does not establish a complete performance of that song.

Distinguish complete musical performance (all songs and musical sections captured in full),
complete uninterrupted recording (the entire performance including between-song material
captured continuously), and unknown completeness when evidence cannot establish either claim.
An edited broadcast can provide complete musical coverage without being an uninterrupted
recording. Missing applause, introductions or conversation therefore does not by itself
invalidate a supported complete-musical-coverage claim. Musical intros/outros remain musical
content, not an exception to full-song coverage.

Default recording preference order:

1. Coverage/completeness.
2. Audio quality.
3. Visual quality, including stability and obstruction.
4. Resolution.

Professional versus audience origin is a configurable preference rather than an automatic winner.
Users can adjust priority order and pin a preferred recording against automatic replacement.
Use verified file properties, explicitly labeled source claims and user assessments. Unknown
quality remains unknown; an unverified claim alone cannot trigger automatic upgrades. User
ratings and pinned preferences take precedence over inferred quality. Advanced automatic
judgments about sound quality, stability or obstruction are deferred, not promised by this
release. Detailed representation and comparison of quality evidence still require design.

Automatic upgrades require a verified improvement under the user's priority order. Ties keep
the current preferred version, and unknown quality does not establish improvement. A gain in
a lower-priority dimension cannot outweigh a loss in a higher-priority dimension; for example,
higher resolution cannot compensate for lost coverage when completeness ranks higher.

Automatic upgrades apply only to monitored performances and must respect pins and saved priorities.
Retain the existing copy until a replacement passes validation and playback-server delivery
confirmation. Keep versions providing unique coverage. Keep older recordings by default after
a successful upgrade. An optional cleanup preference may remove redundant copies only after
replacement validation and delivery confirmation. Pinned recordings and unique coverage remain
protected, and cleanup follows existing deletion warnings, delays and retries. Enabling cleanup
does not itself waive those safeguards.

## Validation, acquisition and delivery

Add separate Validation/Quality policies for full/multipart performances and individual song
clips. Both default to all four established stages:

1. Video-file checks.
2. Motion checks.
3. Import/registration.
4. Exact playback-server delivery confirmation.

As today, users can adjust the first two checks; import/registration and delivery confirmation
remain required. A confirmed setlist.fm event alone never grants reduced source validation.
One song or part of one song uses the individual-song policy; several songs, concert parts
and full performances use the full/multipart policy. Uncertain classification requires all
four validation stages until resolved. There are no automatic source-trust exceptions in the
first live release: official uploads, indexer releases and audience recordings all follow the
saved live policy. Users can adjust optional checks; reputation cannot silently skip them.
Audio-only exclusion and identity checks remain required regardless of policy choices.

Accept valid partial recordings and label their coverage. Missing songs alone do not fail file
validation. Claims such as full concert require coverage evidence; uncertain claims go to review.
Unplayable media or an incorrect performance match block import. Preserve original/staged files
and actionable failure/review outcomes when validation fails.

Preserve the established sequence: accepted identity/source and eligibility -> queue/download ->
configured validation -> import/registration -> target-server notification/reconciliation ->
confirmed playback availability. An imported file or refresh acknowledgment alone is not delivery.
Retain queue controls, recovery and concurrency safeguards for direct and indexer acquisitions.

Inherited validation timing remains: queued items retain a category; saved policy is read when
validation starts, while running checks retain their already loaded policy. Exact mapping of
these new live policies into existing source/category settings requires design review.

## Navigation, storage and playback

Add one Live navigation item with Performances and Recordings views. Artist pages have separate
Music Videos and Live tabs. Filters cover date, place, tour, setting, style, coverage, source and
ownership. Separate views must refer to shared performance/recording identities, not duplicate
catalog entries. Detailed layouts and the monitoring UI remain to be reviewed.

Private/informal locations display a city or descriptive label by default, such as Private
gathering, Austin. Exact addresses are optional private metadata and are excluded from external
searches and Jellyfin/Plex exports unless the user explicitly enables their inclusion.

Configure live storage roots and Jellyfin/Plex playback-library mappings independently of regular
music videos. Full/multipart performances and song clips may share destinations or use separate
ones. Existing files remain in place unless the user explicitly requests a move.

Support optional song timestamps/chapters without splitting original recordings. Allow playback
from a song boundary. Use playlist segments where the chosen destination supports them; otherwise
explain the limitation and offer the full recording or an existing separate clip. Extracting new
clips requires an explicit user action. Actual connector segment capabilities need verification;
this document does not claim Jellyfin/Plex natively support the proposed segment flow.

Use embedded chapters and source-provided timestamps as candidates, checked against song
order and recording evidence. Users may add or correct boundaries. Unverified timestamps
remain visibly uncertain and cannot establish complete-song coverage or song play counts.

Mixed playlists may include regular music videos, live songs and full concerts, with clear labels.
Adding a concert selects its preferred full recording or ordered parts. Adding a song selects its
preferred clip or a supported chapter segment. Keep generation/review -> Push -> publication
confirmation. Unsupported content/segment choices must be visible before publication.

## Qualified plays

Keep native server play history separate from Vidarr's observed qualified plays. Retain the existing
exclusion of seeks, pauses, buffering, duplicate observations and unobserved gaps.

| Playback unit | Agreed qualification threshold |
| --- | --- |
| Individual song | Half its duration or four observed minutes, whichever comes first. |
| Full performance | Half its duration or 30 observed minutes, whichever comes first. |

Reliable chapter boundaries and playback observations can credit both the song and enclosing
performance. Keep song and performance counters separate. Define cross-file/multipart viewing
identity and deduplication before implementation; one viewing must not multiply counts because
it appears through more than one recording/connector/chapter reference.

Accumulate observed watching across successive parts within the same viewing and qualify the
concert once, not once per file. Song counters remain separate where reliable boundaries exist;
overlapping playback must not double-credit watched time.

Retain playback position, unfinished concert-viewing progress and earned watched time
indefinitely. There is no time-based expiry or inactivity window for an unfinished viewing;
the proposed 24-hour cutoff was explicitly rejected. Paused, offline or otherwise unobserved
time still earns no credit. Do not apply disposable discovery/search-journal retention rules
to resume or earned-viewing state.

An explicit Start again action, or restarting from the beginning after confirmed completion,
starts a new viewing. Resuming unfinished playback continues its existing progress and cannot
qualify that same viewing twice. Progress follows the same media-server user across devices.
Different users and unlinked Jellyfin/Plex accounts remain separate; matching display names
never merge their progress. Cross-server progress sharing requires explicit account linking.
Account linking is deferred beyond the first live release; same-server cross-device progress
remains in scope, while Jellyfin and Plex accounts remain separate.

Mark a concert viewing completed only with reliable evidence that playback reached the end
of the recording or its final part. Earning a qualified play does not establish completion.
An explicit Mark finished action may close a viewing without inventing watched time or adding
a play count. Provider-specific end detection, replay handling with edited/alternate recordings
and multi-device event ordering require capability and implementation review.
No historical native count conversion or change to Last.fm reporting is approved here.

When duration or song boundaries are unknown, preserve observed progress but defer any play
count whose threshold cannot be established. A known-duration concert can qualify without
known song boundaries; individual song counts wait for reliable boundaries and durations.

## Unavailability, deletion and migration

Distinguish three situations:

- Temporary server/network/storage/mount failure: preserve ownership and retry; do not delete
  records or immediately acquire a duplicate.
- Confirmed loss after a successful authoritative inventory check: retain performance identity
  and history, mark the owned recording unavailable, use another eligible owned version where
  possible and permit replacement acquisition if monitored.
- Removed external upload/source: mark that source unavailable. An already owned recording
  remains available and is not replaced solely because the remote source disappeared.

Carry forward deletion warnings, the five-minute initial delay, 40-minute retries, in-use
deferral, exact target verification and final confirmation. Exclusion from future scans defaults
to the specific deleted recording, with explicit song-performance or entire-event scope options.
Keep the existing setting that controls whether exclusion is enabled; the new scope default does
not silently enable exclusion. Entire-event exclusion covers only that artist's concert/set,
including its song performances and recording versions. It does not exclude the whole festival,
other artists' sets or songs performed on other dates. Song-performance exclusion covers only
that particular rendition on that occasion. Cross-source exclusion fingerprints still require
technical design.

Deleting a recording, including the last owned recording, preserves the performance entry,
identity, setlist, evidence and performance play history. Remove only the selected recording and
its targeted files/server copies. Removing the performance itself is a separate explicit action;
its dependent-data behavior must be reviewed rather than inferred as a cascading media deletion.
Block performance removal while owned recordings or active downloads remain. Require the user
to remove or reassign those recordings and resolve active downloads first. Removing a
performance entry must never implicitly delete media files.

Existing Flag as Live/Concert entries enter a migration review proposing classification and
performance matches. Preserve files, ownership, counts and playlist references; confident matches
can be accepted in bulk and uncertain entries remain available. The existing button becomes the
ongoing correction entry point for live material mistakenly placed in Music Videos. Reclassification
does not trigger another download. Keep the recording playable and visibly marked Awaiting
classification during review. Once confirmed, it appears in the appropriate section. Corrections
remain reversible while preserving files, counts and playlist references. Returning to Music
Videos requires that section's normal eligibility checks. Do not silently discard an unresolved
item from both views.

Implementation must use backward-compatible Prisma migrations and preserve existing artist,
media, queue and playlist identity/reference integrity. A future migration plan must specify how
counts and references transfer without duplication. No migration is created during this phase.

## Acceptance criteria for the eventual implementation

1. The same confirmed artist appears in Music Videos and Live without a second artist identity.
2. An acoustic television song is one performance visible through both applicable filters.
3. Different dates remain different performances; guest credits do not duplicate performances.
4. Full recordings, ordered parts and song clips link to shared song performances while retaining
   original files and independent source/ownership facts.
5. Exact artist/date/venue/song evidence with no conflict permits automatic confirmation;
   ambiguous or contradictory evidence goes to review without silent reassignment.
6. An unmatched performance remains usable with evidence and unknown fields, and can later link
   to external references without losing its local identity or ownership.
7. Audio-only/static-image-audio content is excluded even when official or event-matched.
8. External corrections preserve user edits and existing recording links pending conflict review.
9. Monitoring can initiate eligible acquisitions within explicitly chosen scope; recording-unknown
   events do not inflate missing totals. Broad monitoring previews estimated searches and scope,
   supports narrowing/pause/cancel, respects daily and provider budgets, and defers rather than
   discards unfinished work. Empty-result backoff and protected-entry retention follow the rules
   above, including agreed 50/500 daily request budgets and one-year lightweight search history.
10. Multiple useful versions are retained, identical uploads are deduplicated, and pins prevent
    automatic preferred-version replacement.
11. Full/multipart and song policies default to all four stages; event matching cannot bypass
    required content/identity, import or delivery checks.
12. Partial recordings can import, but uncertain full-coverage claims remain reviewable and
    unplayable/incorrectly matched recordings do not become owned imports.
13. No upgrade removes a working copy before replacement validation and delivery confirmation;
    unique coverage remains retained.
14. Existing files do not move during classification or settings changes. Optional extraction
    occurs only through an explicit user action.
15. Mixed playlists preserve order and clearly report unsupported segment publication rather than
    claiming success. Review, Push and publication confirmation remain separate outcomes.
16. A 6-minute song qualifies after 3 observed minutes; a 40-minute full performance after 20;
    a 120-minute full performance after 30. Native history remains separate.
17. Reliable chapter viewing contributes to the correct song/performance without duplicate credit
    from repeated events or overlapping references. Successive parts aggregate toward one concert
    viewing; unfinished progress persists indefinitely. Resume does not duplicate qualification.
18. A temporary connector/mount outage causes no replacement acquisition; confirmed loss and
    removed external sources have the distinct recovery behavior specified above.
19. Deletion honors configured warning/exclusion preferences and selected scope without deleting
    unrelated recordings or losing event history unintentionally.
20. Reclassifying an existing flagged video preserves its file, counts and playlist references,
    remains reviewable where uncertain, and does not queue another acquisition.
21. Unknown duration/boundaries defer only the affected counters while preserving observations.
    Completion is distinct from qualification; Mark finished creates no play or watch credit.
22. Deleting the last recording preserves event/setlist/evidence and performance play history;
    exclusion does not silently expand to other artists or dates.
23. Precise private addresses do not appear in external queries or server exports by default.

Behavioral verification must exercise failures and recovery as well as successful flows. Connector
capability checks, safe sample discovery and migration rehearsal are prerequisites to production
acceptance; test fixtures must not delete user media or submit changes to external databases.

## Remaining technical verification and implementation planning

Product policies and the three planned UI layouts are approved. Remaining entries identify
technical research and implementation design, not unanswered approval questions for the user
or authorization to reopen agreed rules or begin coding.

| ID | Remaining technical work | Agreed constraints |
| --- | --- | --- |
| O1 | Estimate sampling, fair-scheduling mechanics and production monitoring-state wiring. | Monitoring layout is approved alongside 50/500 budgets, shared-cost accounting, inheritance, exclusions and preview/pause/cancel. |
| O2 | Concrete page/batch sizes, pagination/response caching and exact provider-failure backoff timings. | Date-first progressive fetching, 1/7/30/90-day empty retries, 90-day discovery expiry, one-year lightweight history and distinct provider-error recovery are agreed. |
| O3 | Map independent matching/classification/coverage states into durable API and UI behavior. | Review layout and side-by-side evidence/actions, automatic-rule-only bulk confirmation and reversible, playable Awaiting classification transitions are approved. |
| O4 | Technical identity verification, cross-source duplicate suggestions and timestamp/evidence representation for multi-event compilations. | Auto-deduplication is restricted to verified identical files or the same provider item; uncertain matches require review. Compilations link sections without automatic splitting. |
| O5 | Practical verification of coverage/boundaries and uninterrupted-recording claims. | Embedded/source timestamps are candidates checked against order/evidence, with user corrections. Unverified boundaries establish neither complete songs nor song play counts. |
| O6 | Source trust detail, indexer categories/query patterns and client capability/unknown-pack fallbacks. | Direct/indexer candidates share quality ranking. Select eligible pack files when supported; otherwise approve full size/contents before acquisition; unrelated files never auto-import. |
| O7 | Quality-evidence representation and technical comparisons. | Verified priority-order improvement is required; ties retain the current preference. Unknown claims alone cannot upgrade, and advanced automatic quality analysis is deferred. |
| O8 | Practical checks for long files and mapping into existing settings/queue categories. | Excerpt policies are agreed; unknown classification gets all four stages. No automatic source-trust exceptions in the first live release; a probe is not a full-integrity guarantee. |
| O9 | Supported Jellyfin/Plex library item types, metadata layout, chapter/segment APIs, capability fallback and destinations. | The desired playback experience depends on verified server support. |
| O10 | Provider end detection, event ordering/identity across clips or alternate recordings and reliable cross-device persistence. | Progress/replay/completion rules are agreed; account linking is deferred and separate Jellyfin/Plex users are not merged. |
| O11 | Data/API schema, atomic migration/reclassification, count preservation, playlist references and rollback. | Translate the agreed domain into backward-compatible storage and workflows. |
| O12 | Cross-source exclusion fingerprints, dependent-data preservation on performance removal and safe optional cleanup implementation. | Removal is blocked by owned recordings/active downloads and never implicitly deletes media. Scoped exclusion, retained history, privacy and cleanup safeguards are agreed. |

Complete technical verification and present the implementation/migration plan before coding.
This document does not settle every operational limit, promise automatic media analysis or
authorize an implementation agent to silently fill product gaps. No additional UI approval is
currently queued; new material tradeoffs still require review if investigation reveals them.

## UI review progress (2026-10-17)

Monitoring setup preview was approved by the user ("looks good"). It includes artist/tour/
performance scope, year/setting/style/origin/coverage filters, discovery sources, estimated
first-pass request ranges and budget days, known recordings, cached/shared work, per-rule/global
budgets and policy disclosures. Activation, pause, cancellation and editing are local preview
states only. Example catalog sizes, provider requests and global usage are clearly illustrative;
they are not measured from a real artist or connected provider.

Preview checks confirmed budget-driven time estimates, scope-driven request estimates,
activation/pause/cancel states and invalid-range handling. This validates preview interaction,
not the future production estimator or connector behavior. No monitoring rule was created and
no live searches or downloads were started.

Match/classification review preview was approved by the user ("good"). Three fictional
examples cover an exact match, conflicting event evidence and no external event. It presents
side-by-side field evidence, candidate selection, original provenance, editable classification,
individual supporting-reason confirmation, independent entries, candidate rejection and undo.
Bulk confirmation includes only eligible candidates and leaves uncertain entries untouched.
Existing files/references remain preserved; source acceptance and validation are separate.
Checks exercised bulk exclusion, candidate changes, confirmation/undo and independent retention.
Playback/chapters/resume preview was approved by the user ("good"). It distinguishes
position, observed watching, qualified plays and completion; retains unfinished progress;
supports Resume, Start again and Mark finished; and shows per-server user progress separately.
Song rows distinguish verified and uncertain boundaries. Playlist choices explicitly offer
an existing separate clip, the full recording/ordered parts or an extraction request when
bounded chapter publication is unverified. No implicit clipping or playlist publication occurs.
Preview checks confirmed completion/restart preserve prior counts, chapter jumps add no watched
time, unavailable timing disables song actions, whole-recording fallback remains explicit,
and switching sample Jellyfin/Plex destinations does not merge their viewing progress.
All viewing/ownership/capability data is illustrative; no server was contacted or media played.

## Preliminary playback capability research (2026-10-17)

This is a documentation/source review, not a live-server/client test. No playback, playlist
publication, server reconfiguration or provider-account changes were performed.

| Capability | Evidence and limit |
| --- | --- |
| Jellyfin video destination | Its Music Videos library supports video files and movie-like organization, with nested folders and no default external metadata provider. Validate specific multipart/version naming on the intended deployment before choosing a layout. |
| Jellyfin starting offset | The official SDK PlayRequest exposes StartPositionTicks for the first item. This establishes a start-offset control, not a verified end boundary or portable chapter-only playlist item. |
| Jellyfin playlist publication | CreatePlaylistDto accepts item IDs. Vidarr's current provider likewise publishes whole item IDs; no bounded-segment behavior is implemented or verified by that path. |
| Jellyfin progress/resume | The SDK exposes user playback position and session progress/stop positions. A stop report does not by itself prove completion, and these positions do not represent observed accumulated watching across multipart concerts. |
| Plex live organization | Official support documents concert/live artist-video naming. This is one available organization model, not proof it meets Vidarr's separate mapped playback-library, playlist and ownership requirements. |
| Plex chapters | Official iOS documentation supports selection of embedded chapters. This is client-specific evidence of chapter navigation, not proof that every client or a published playlist can play only one chapter and stop at its end. |
| Plex playlist/progress API | Official API documentation supports playlists using content URIs/play queues and timeline state/offset/duration reports. Vidarr currently publishes whole rating-key references and reads active session positions. Bounded song-segment publication remains unverified. |

Design consequences: capability-check library types, chapter navigation, starting offsets and
bounded segment publication separately. Do not infer stop-at-song-end support from chapter
selection or a starting offset. Apply the already agreed fallback rather than publishing a full
concert disguised as a song segment. Maintain durable user/performance resume and earned-viewing
state independently of short-lived playback sessions and disposable diagnostic journals, to
satisfy indefinite retention and multipart aggregation. Validate client behavior, end detection,
multiple versions and native playlist limitations in a later explicitly scoped playback test.

Local source references inspected: `apps/server/src/providers/library/jellyfin.ts` and
`apps/server/src/providers/library/plex.ts`, especially fetchPlaybackSessions and pushPlaylist.
No provider implementation was changed.

Primary sources:

- [Jellyfin Music Videos](https://jellyfin.org/docs/general/server/media/music-videos/).
- [Jellyfin PlayRequest](https://typescript-sdk.jellyfin.org/interfaces/generated-client.PlayRequest.html), [playlist DTO](https://typescript-sdk.jellyfin.org/interfaces/generated-client.CreatePlaylistDto.html), [user data](https://typescript-sdk.jellyfin.org/interfaces/generated-client.UserItemDataDto.html), [progress](https://typescript-sdk.jellyfin.org/interfaces/generated-client.PlaybackProgressInfo.html) and [stop reports](https://typescript-sdk.jellyfin.org/interfaces/generated-client.PlaybackStopInfo.html).
- [Plex local artist/live videos](https://support.plex.tv/articles/205568377-adding-local-artist-and-music-videos/), [iOS chapter selection](https://support.plex.tv/articles/205671108-media-playback/) and [official server API](https://developer.plex.tv/pms/).

## Explicit exclusions and deferred work

- Audio-only acquisition/support unless separately approved as a new feature.
- Setlist.fm submission assistance or automated external edits.
- Automatic clip extraction, mandatory file merging or implicit relocation of existing files.
- Treating every historical event as wanted, missing or guaranteed to have a recording.
- Copying the music-video official-title rule into live event/recording confirmation.
- Advanced automatic sound-quality, camera-stability or obstruction judgments.
- Cross-server user-account linking and shared Jellyfin/Plex viewing progress in the first release.
- Production changes, schema migrations, external publication or deployment during design.

## Research references

Reviewed during the design discussion; these describe provider capabilities, not verified coverage
for every artist or guaranteed playback-server support.

- [MusicBrainz events](https://musicbrainz.org/doc/Event) and [event setlist syntax](https://musicbrainz.org/doc/Event/Setlist).
- [Artist/event roles](https://musicbrainz.org/relationships/artist-event) and [song Works](https://musicbrainz.org/doc/How_to_Use_Works).
- [Event/recording links](https://musicbrainz.org/relationships/event-recording), [event external links](https://musicbrainz.org/relationships/event-url) and [recording external links](https://musicbrainz.org/relationships/recording-url).
- [Recording identity/style](https://musicbrainz.org/doc/Style/Recording) and [standalone video recordings](https://musicbrainz.org/doc/How_to_Add_Standalone_Recordings).
- [Setlist.fm artist identity bridge](https://www.setlist.fm/help/import), [setlist model](https://api.setlist.fm/docs/1.0/json_Setlist.html), [named sets](https://api.setlist.fm/docs/1.0/json_Set.html) and [editing/eligibility guidelines](https://www.setlist.fm/guidelines).
- Existing Vidarr contracts: [product vision](../product-vision.md), [process flows](../process-flows.md), [playlist workflows](../discovery-playlist-workflows.md) and [qualified playback](../qualified-playback.md).
