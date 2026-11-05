# Process flows and consistency review

## Automatic publication of generated playlists (2026-11-04)

The user's Generate-always-publishes revision supersedes the separate post-generation membership
review and Push steps for generated music-video playlists. Review the player library, count,
order and active rules → Generate authorizes creation and publication → refresh selected server
inventory → evaluate rules and confirm availability → save ordered membership → publish through
the normal server connector → report complete, partial or failed publication. A local save alone
is never described as published. Destination selection, identity/availability checks and final
publication outcome remain required; Generate does not start playback or acquire missing media.

Publication failure preserves the generated playlist, records the failed Push and exposes retry
with Push. Retry does not regenerate or create another local playlist. Smart regeneration also
retries an initially failed publication without a remote ID. API callers omitting a destination
can use a valid saved default or a sole enabled player; ambiguous/no destinations are rejected
before creation. Manual curated/Live playlist review and Push are unchanged.

## Artist navigation and unconfirmed observations (2026-11-04)

Browse Music Videos or Live → apply current filters → alphabet letters include confirmed artists
and unconfirmed observations → open an **Unconfirmed** row → Artist Review resolves and confirms
the MusicBrainz identity → continue normal catalog/video review or Live discovery. Visibility does
not confirm identity, establish catalog ownership or admit source videos. Linked observations are
represented by their canonical owner. Music Videos retains its empty-artist filter; Live does not
require music-video ownership. The list and rail use the same eligible observation set.
Recovery from an interrupted sync verifies an existing embedded/connector MBID against its current
source before applying the existing enrichment path; name-only observations remain Unconfirmed.
See [navigation and recovery](library-artist-navigation.md).

## Live discovery matching and confirmation (2026-10-27)

Add a Live video candidate -> queue both MusicBrainz and setlist.fm checks -> inspect thumbnail,
match flags and vertically stacked source-attributed fields -> optionally retry a provider or
explicitly check another setlist.fm page -> Confirm and Grab -> attest performer/occasion, actual
moving video and exact upload (acknowledge conflicts) -> normal recording/source acceptance ->
acquisition -> validation -> import/delivery -> exact playback-server catalog confirmation.
Unknown fields stay unknown and no reference is automatically merged into an event identity.
The same list/search/page position remains after submission. Queue acknowledgement is not delivery.
Ignore persists through rescans; it does not delete media or cancel downloads. Reference leads
retain the separate explicit performance-search flow and cannot be grabbed as video sources.

The user also requested existing-candidate backfill. A persisted cursor prepares 50 candidates
and attempts five provider checks per minute; failures remain visible and retry after 30 minutes.
Live disablement gates automatic work. Bounded no-match, pending, failed and unavailable remain
distinct. Reads and presentation actions never acquire media. This supersedes the strictly
on-request candidate-matching portions of the historical 2026-10-23 sections below; general
history traversal and the old metadata monitoring task remain unchanged.
See [matching, budgets and recovery](live-candidate-matching.md).

## Consistent genres and playlist generation (2026-10-25)

View effective artist genres with source attribution → choose a broad group (including its mapped
subgenres) or a normalized specific label → Library applies the same hierarchy before counts,
letters and pagination (genre-page links explicitly include artists without videos so their totals
match the group) → optionally open Create playlist with that genre prefilled → choose the
playback library/count/order and active rules → Generate acknowledges the request and refreshes
inventory/matches available videos → save membership and automatically publish to the selected
server → report publication outcome. Retained video tags use the same matcher; available-video membership
and artist-based genre counts remain different measures. Existing static membership is retained;
smart rules use the matcher only on regeneration. Failures remain visible and retryable.

Live mode offers Generate music-video playlist as an explicit mode switch, preserving the reviewed
recording-to-static-playlist flow for Live. It never silently adds unreviewed Live discoveries to
generated playlists. If the current media filter hides every saved playlist, explain that state
and offer Show all playlists. Loading/failure is not reported as an empty collection.

Genre accuracy/cleanup: inspect source candidates and effective labels → preserve source precedence
and manual edits → review advisory alias/small-group hints → explicitly edit an artist if desired.
No hint, page visit or provider refresh performs mass consolidation or removes stored candidates.

## Existing-artist source population (2026-10-23)

Explicitly request collection for all existing artists → snapshot confirmed MusicBrainz artist IDs
→ persist the requested batch and cursor → collect shared artist/VEVO sources and enabled Live
leads one artist at a time → checkpoint success/partial failure → immediately continue while work
remains → show progress and current artist in Live. Restart repeats an interrupted artist safely.
Unconfirmed observations remain in identity review. Failed providers preserve earlier discoveries
and are counted for retry; a completed pass does not claim every provider succeeded.

This batch performs source discovery only: no missing-video acquisition search, IMVDb expansion,
local-file traversal, monitoring changes or download submission. setlist.fm is never consulted.
The discovery/review/validation/import/delivery stages above retain their existing requirements.

## Live starting points and on-request references (2026-10-23)

Confirm shared MusicBrainz artist → resolve artist/VEVO links → existing shared source collection
→ independently retain MV observations and enabled Live candidates → retain bounded MusicBrainz
Live releases/broadcasts/direct performer events as search leads → show a short starting list
on first Live entry and artist opening. Display choice never gates background persistence.
Progress and partial errors are visible; retries retain prior data and dismissed suggestions.
General enablement and installed capability gate new Live preparation/searches, preserving data.

Choose Review video for download → create/reuse exact-source pending recording and independent
unknown-date/place performance → normal artist/occasion and moving-video review → accepted source
→ existing acquisition, validation, import and exact playback-server delivery confirmation.
Choose Open performance search → create/reuse a reference identity → explicitly Search videos
now → normal candidate review and remaining stages. Release/publication dates stay evidence;
they never populate a performance date. Opening a lead starts no provider video search/download.

setlist.fm: user opens artist discovery controls → explicitly requests one history page → provider
budget/cache/authentication checks → save reference results → optionally request another page.
Opening Live, adding artists, monitoring and old metadata cursors never fetch or traverse history.
This supersedes automatic metadata traversal described in the historical Unified Live section.
Existing saved references/rules and credentials are retained; monitoring uses saved performances.
See [implementation and recovery](live-starting-inventory.md).

## Artist-first Live browsing (2026-10-22)

Select Live mode → retain the shared artist index, letter rail, name/genre filters and artist list
→ open/expand a confirmed artist → browse/filter only that artist's performances or recordings
→ load a bounded event-history page or search an identified performance → normal identity/content
review, acquisition, validation, import and exact server delivery confirmation. Artists without
music videos remain visible; music-video counts and bulk acquisition controls are not Live controls.
Root Live/Discover/workflow views present the artist list instead of a global Live search. Both
mode keeps the shared artist list, with both catalogs available on an artist's page.

Catalog text searches without artist context are rejected by the server. Existing unfiltered,
paged catalog reads remain compatible. Performance search and monitoring already require an
artist-linked performance/artist scope. Missing/paused setlist.fm credentials disable event-history
loading with an explanation and settings link; saved browsing and independent entry remain usable.
Enter/replace the single global setlist.fm key in Settings → General → Library beside IMVDb →
Save → clear the in-memory key field and refresh configuration status → retry the artist's history
page. Blank input preserves the saved key; responses expose only a configured flag. The existing
Live configuration row remains its storage, and key changes preserve policy/budgets/destinations.
Live settings link to this global field rather than duplicating credential entry. Failed requests
never imply empty results. Saving a key establishes configuration, not successful provider access.

MTV overlay development is paused: archived source under `future/mtv-overlay` is excluded from
current builds/deployment. Previous native-overlay flow below is historical, pending future work.

The 2026-10-24 restart authorizes an isolated standard-client proof of concept: create synthetic
media and timed ASS tracks → start a separate Jellyfin instance → discover subtitles and test
selection/burn-in through playback APIs → inspect rendered timing and late seeking → verify
physical Roku playback, playlist transitions and pause/resume → evaluate supported plugin
activation. API success does not complete device verification. Subtitle-off selection is a
control case: no selected track means no overlay. Production acquisition/review/delivery stages
are unchanged. Stop only the recorded lab process after checking its command line; retain lab
data for inspection. See [test and recovery steps](../integrations/jellyfin-mtv-poc/README.md).
The user then authorized a production fixture test: snapshot server/user/library/playlist state
→ checksum-copy only synthetic fixtures → register a separate test library → refresh only that
test scope → verify ASS discovery → create the dedicated playlist → probe explicit subtitle burn-in
→ user selects the track in Jellyfin on Roku → record physical playback outcomes. Preserve existing
subtitle preferences; selecting a track differs from enabling Roku's global closed captions.
Server/API evidence remains distinct from device confirmation. Recovery targets only the recorded
test playlist/library and retains files/baseline until checked.
An explicitly approved temporary default-selection diagnostic snapshots the user's current two
subtitle fields → arms a five-minute rollback → applies Always/English → verifies server-side
automatic track selection → user restarts the test queue → observes device behavior → restores
and verifies the saved fields. Early completion requests early restoration. Recovery state is
saved before mutation; unrelated current preferences are retained, and independent conflicting
changes to the two controlled fields stop automatic overwrite for review.
The subsequent approved plugin flow replaces temporary user-default changes: administrator selects
music-video libraries/settings → explicit paged generation writes only owned ASS sidecars → public
Jellyfin stream-repository registration appends the owned track without renumbering existing
audio/video/foreign-subtitle streams → enabled playback filter selects only a matching owned MusicVideo
track before negotiation → normal Jellyfin burn-in/transcoding → client verification. Movie/episode
and unknown/alternate-source requests pass through unchanged. User subtitle defaults are never
modified. Disabling stops automatic selection but retains generated tracks/backups for recovery.
The requested 0.1.3 layout uses quoted song title, album with its album year, record label and
Director/s credits. Generation resolves album year only from a unique local album-title/artist
match, omits unknown/ambiguous fields, and embeds the DLL's bundled Kabel font into the owned ASS
track. Upgrade while idle, preserve the ownership manifest/backups, regenerate, then verify
rendering and playback before considering the layout deployed. OS font installation is unnecessary.
See [plugin scope and verification](requests/2026-10-24-jellyfin-mtv-plugin.md).
For real-library rollout: snapshot exact inventory/configuration and media size/timestamps →
check idle playback before plugin restart → verify standard Web/Roku playback → generate with
activation off → report unreadable/unknown-duration files without inventing timing → confirm all
valid tracks are indexed → enable selected music-video libraries → sample both explicit-source
and omitted-source playback requests → confirm original libraries/playlists/preferences and media
attributes are preserved. Web's omitted source ID is supplied only for an eligible primary video.
An active session defers restart; it is never stopped implicitly. Recovery restores the saved
prior plugin configuration and retains generated sidecars/ownership records for inspection.
The 0.1.1 queued full-refresh indexing experiment is superseded by 0.1.2 targeted registration.
After an interrupted experiment, retain the exact disabled configuration and manifest → load
the tested release while idle → rerun generation to register unchanged owned files → verify every
valid track and both playback request styles → activate. Independently confirmed user deletions
are narrow baseline exceptions, never grounds for recreating deleted playlists or accepting
unrelated missing data. Preserve the original baseline alongside any authorized exception copy.

## Button engagement and request feedback

Activate an enabled button → immediately acknowledge the click → run existing validation and
confirmation → show pending feedback while its associated handler, request or mutation is running
→ restore the current action label when it settles. A rejected action briefly shows Failed;
existing page errors remain available and the action can be retried. Cancelled confirmation or
failed native form validation receives click acknowledgement without claiming work is pending.
Only the pending control is blocked against repeated activation. Queue and task status remain
the authority for background completion; response receipt does not establish validation, import,
delivery or publication success. See [shared button feedback](button-feedback.md).

## Native MTV overlay direction (2026-10-19)

Choose a supported playback client/build → install and enable its optional overlay → play the
existing music-video item → draw the lower-left information block using playback position and
imported metadata → hide outside the first/last six seconds and clear on item change/stop.
The user explicitly replaced pre-rendered copies with this native workflow. No derivative
rendering, separate library, derivative delivery or playlist substitution is needed. Original
acquisition, validation, import and exact original-file server confirmation remain required.
The undeployed pre-render implementation was removed. Roku and web are separate optional client
source components: verify the pinned source checksums → install the component → build the client
→ install/deploy that client → enable its playback setting → verify actual server/device playback.
An installer/build success alone does not confirm device playback. Failed compatibility checks
leave source unchanged; removal restores saved originals after checking for intervening edits.
Unknown duration permits intro display only. See [native implementation](mtv-overlay.md).

## Planned Slim and Full editions (not implemented)

The [build-edition requirement](requests/2026-10-18-build-editions.md) explicitly authorizes a
future Slim flow omitting video-file/stream and motion validation (types 1 and 2), with no
FFmpeg dependency. All other functionality and required identity, metadata eligibility, review,
ownership, import, exact delivery confirmation and playlist publication outcomes remain.
Unavailable checks must not be labeled passed; unresolved visual eligibility stays reviewable.
Full retains the existing configurable checks. The flows below describe current behavior;
this documentation request changes no runtime behavior or deployed build.

## Global catalog browsing filter

Choose Music Videos, Live & Concerts or Both in the global navigation bar → retain the choice
in browser storage across pages and reloads → retain the artist index/list → open the selected
artist's catalog(s). Both shows independent labeled sections on artist pages and keeps embedded
Live search/pagination in `live.*` URL parameters so
music-video filters do not change Live results. Live & Concerts uses an inverted light palette;
images are not inverted. Hide Artists w/o Videos remains the existing music-video artist rule
and sits at the right of the Library navigation bar. Shared identities and settings remain common.

Queue, completed/failure queue pages and History deliberately ignore this selection. Their filter
buttons are all deselected and disabled, with an All categories explanation. Visiting them never
overwrites the remembered choice. Returning to catalog browsing restores its selected state.

Playlist browsing filters both cards and visible entries while retaining complete saved membership.
Hidden members are stated explicitly; Push and playlist-wide actions use the full saved playlist.
Reordering is disabled until all members are visible. Music-video rule generation is hidden in
Live & Concerts; reviewed live versions are added through their existing recording actions.
Review/import/calendar routes show the selected catalog workflow; live work begins by selecting
the exact event/recording. This selection starts no provider search, acquisition, import or deletion
and preserves all identity, content, review, validation and server-confirmation stages.

## Confirm library-wide searches

Library → Search all eligible → read-only eligibility preview → confirmation showing the number
of video searches, library-wide scope and automatic acquisition consequences → search only the
approved IDs that remain eligible → report grabbed/skipped results. Cancel, preview failure and
zero eligible searches submit no search request. The count is video search attempts, not provider
HTTP requests: each attempt may query multiple providers. Current Library filters do not narrow
this action. Identity, source review, validation and delivery checks remain required. Scheduled
backlog searches retain their existing automatic behavior.

API clients first GET `/api/v1/artist/search-all-missing/preview` for `searches` and `videoIds`,
then POST `/api/v1/artist/search-all-missing/confirmed` with the approved `videoIds` array. The server
rechecks eligibility and intersects the approved set, so later additions cannot expand the run.
The confirmed POST requires explicit IDs. The existing `/search-all-missing` POST remains
available for backward compatibility with automation clients; Library uses the confirmed endpoint.

## Live catalog implementation

The [concerts and live performances design](requests/2026-10-17-concerts-and-live-performances.md)
describes proposed discovery, matching/review, acquisition, validation, delivery, correction and
recovery flows. Product rules and UI previews are approved; live implementation still requires
technical capability verification. The user has now authorized starting implementation. The
current music-video flows below, including the label-only Live/Concert action, remain unchanged.

The first [catalog increment](live-implementation.md) supports: choose an existing confirmed
artist → save an independent performance with known/unknown date/place and ordered song
occurrences → retain recording evidence as pending candidates. A source URL or full-concert
claim does not validate identity, video content, coverage or ownership, and starts no acquisition.
Setting/style filters and paged lists refer to stable shared identities. Corrections use a
revision check; stale edits return a reload conflict and retain prior song/recording links.
Artist removal returns a conflict while live performances exist; it cannot cascade live history.
The migration only adds tables; existing Live/Concert flags are left for future migration review.

## Shared backend foundations

The [backend alignment audit and migration plan](backend-alignment.md) records the authorized
foundation refactor. Ownership/acquisition, watched-time observation and physical inspection
use shared mechanics with explicit music-video policies and compatibility entry points.
Identity, review, validation choices, import, delivery confirmation, deletion and playlist
publication stages retain their existing outcomes. This introduces no live workflow or schema change.

## Large playback-library synchronization

Inventory refresh deduplicates confirmed catalog video IDs and processes delivery confirmation
in batches of at most 500 IDs, including follow-up delivery and artist reconciliation writes.
Each batch retains the mapped playback-library and exact delivered-path checks. This avoids
SQLite's parameter limit for queries containing negation filters. Playlist generation still
reports a failed refresh and uses the last synced inventory; review and Push remain required.

## Server play counts only (2026-10-18)

Connect a selected Jellyfin/Plex video library → synchronize confirmed inventory/native play counts → show known server counts or unknown. Vidarr does not calculate or increment music-video, performance or song plays. Qualification polling and thresholds are retired; the old protected playback webhook returns HTTP 410. Remove obsolete notification destinations from Jellyfin. Resume observations retain viewing progress indefinitely but create no play count. Last.fm submission remains independently authorized and uses its own eligibility rules. Historical counter fields/rows remain inactive for rollback; APIs omit them. No media or database history is removed.

## Artist video actions and deletion (2026-10-16)

Open artist → optionally expand Genres → filter Videos by name → act on a visible video.
Flag as Live/Concert updates only its persisted label and can be reversed. Existing canonical
identity, source admission and validation outcomes remain intact.

Delete → load saved warning preference → confirm if enabled → reject active/waiting acquisition →
persist deletion intent and freeze targets → wait five minutes → preflight the owned local bundle and all confirmed
server copies → defer if any matched server session is playing or paused → delete server items → confirm each exact item is absent → remove the local bundle →
atomically record deletion identities and remove Vidarr catalog/ownership, confirmed observations,
playlist references and corresponding review decisions. Never delete by title on a server. Verify
current item identity, type, selected library membership and every media path against the matched
path; changed or additional versions require reconciliation. Local paths must be regular files
inside an accessible configured root; symlinks, unavailable mounts and shared ownership block
deletion. Delete only the video and same-base metadata/artwork/subtitles, not the artist directory.

A one-minute scheduled job processes due deletions in bounded batches. Any server, playback check or filesystem failure retains the entry and frozen remaining targets with a visible
error and a next attempt 40 minutes later. Further failures retry every 40 minutes. Reschedule delete restarts the five-minute delay. Already absent targets are safe on retry; authentication errors are not
treated as absence. Pending deletion is ignored/unmonitored to prevent reacquisition. Restart
marks interrupted work failed and schedules retry 40 minutes later; pending deadlines survive restarts.

`DELETE /api/v1/musicvideo/:id` accepts `{ "confirmed": true }` when warnings are enabled and
returns `202 { "scheduled": true }` after persisting the request. It does not report completion.
Artist/video responses expose deletion state, error, attempt count and the next attempt time.
An already scheduled request or active download returns 409. The one-minute job never runs an
attempt before its persisted deadline, even when invoked manually from System / Tasks.

Settings → General → Video deletion → independently save Warn before delete and Exclude deleted
videos from future scans. Defaults are on/off respectively. All successful deletions retain minimal
identity fingerprints. Scans consult the current exclusion preference: enabled suppresses matching
provider IDs/local paths (artist-scoped title fallback only without IDs); disabled allows normal
discovery and review again. Settings changes do not restore deleted files or delete catalog entries.

## Category validation policies (2026-10-16)

Settings → Validation/Quality → select Check video file and Check video motion per category →
save the complete policy and thresholds atomically. Existing quality profile controls remain at
the bottom, with existing assignments unchanged; the old quality-profile route redirects here.

Acquisition still requires accepted sources and ownership/ignored/eligibility checks. Queueing
records canonical vs supplementary/additional from the actual selected source. Only accepted,
confirmed authoritative/verified direct sources qualify as canonical; other direct and indexer
sources default to additional. After transfer completes, load the current category policy once →
perform enabled file/motion checks → atomically import → confirm exact playback-server inventory.
Canonical downloads skip file/motion checks by default; additional downloads enable both. Existing
queued downloads use the policy current when validation starts, per the user's explicit decision.
Later settings edits do not change checks in flight. An invalid stored policy fails visibly.

Existing local-file approval validates with the initial-import policy (both checks on by default)
before committing ownership. Failures leave the candidate pending and the file intact. Success
registers it in place and marks delivery pending, then requests mapped server refresh. Existing
files are never moved merely to register them or resubmitted merely because validation fails.
Import/registration and exact server confirmation cannot be disabled. No full-file validation
policy changes discovery's separate bounded sample or metadata/identity checks.

## Library alphabet navigation (2026-10-16)

After addition or search, Library computes letters and ordering from the displayed artist name,
ignoring leading The, A or An. It applies the selected letter and other filters before pagination;
available letters use the same name convention. Surname-first MusicBrainz sort names remain stored
metadata and cannot hide Ingrid Michaelson from I. Visibility, collection and review stages remain
unchanged; clearing filters still reveals zero-video confirmed artists.

## YouTube Music official discovery (2026-10-16)

Artist addition, Refresh all sources and scheduled channel checks traverse standard uploads and
the linked Music page. Music video/official shelves and artist-created playlists are expanded,
including View all and continuation pages; albums and unrelated recommendation shelves are not
catalog inputs. Merge by video ID while retaining official category/title evidence and origins.

For an official-keyword candidate: validate the confirmed artist/song credit → exclude audio,
lyrics, visualizers, live performances/concerts and other non-song-video content using metadata →
check a bounded motion sample → atomically create/link the canonical official video, accepted
YouTube source and approved decision. The keyword stage automates authority evidence, not identity
or content checks. Uncertain checks remain in Video Review; failed sample/metadata inspection does
not count as acceptance. Conflicting explicit artist credits remain reviewable. Prior manual
approvals/rejections and pending reviews owned by another artist are preserved.

New canonical videos are unmonitored and collection enqueues no full downloads. Acquisition still
requires eligibility/ownership checks, transfer, full-file validation and atomic import, followed
by separate target-server delivery confirmation. Official audio and live/concert material remain
excluded today; future live categories are not implemented.

Partial results persist before a failed scan reports incomplete coverage. Only complete traversal
advances the channel success timestamp; the established ten-minute collection retry handles
provider errors. Requests have deadlines and traversal caps (100 continuation pages per shelf,
100 playlists per channel); reaching a cap is partial, not silent success. UI remains on the artist
page with existing source status and Video Review links. No schema change is needed.
Scheduled polling continues after a failed source and checks equivalent standard/Music links once
per artist; failed sources retain their prior success timestamp for a later retry.

## Artist defaults and queue ordering (2026-10-16)

Library additions preselect Any quality and the oldest root mapped to a playback video library,
falling back to the oldest configured root. If Any is absent, the oldest profile is used.
Users can override Library selections; Discover additions use the same defaults. Missing roots or
profiles still require configuration, and selecting a validated MusicBrainz identity remains required.
Existing canonical artists retain their saved settings when reused. Collection and uncertain-video
review continue unchanged; partial source failures retain data and the ten-minute retry path.

Queue offers Move up/down/to top/to bottom for waiting downloads only. A successful action persists
the new order and refreshes the list. New requests join the end; restarts preserve ordering.
If the item has already started or disappeared, the action reports the conflict and reloads the
queue. Concurrent reorder and dispatcher claims are serialized by the database. Ordering changes
transfer selection only: active transfers finish, processing stays in transfer-completion order,
unknown submissions retain reservations, and validation/import/delivery checks remain required.

## Transfer/processing pipeline (2026-10-15)

The required acquisition stages are preserved: accepted source and eligibility checks → transfer
and merge → configured category validation → atomic import → separate target-server delivery confirmation.
Three network slots no longer become unavailable simply because three videos are processing.
A single processing worker takes staged files in download-completion order. Reservations include
transfers, unresolved submissions and staged processing work, defaulting to the configured transfer
limit plus three. This reserves space before simultaneous transfers finish, bounding the staging
buffer. New transfers also stop below the staging storage minimum-free-space setting. Failed
bundles remain available for recovery and consume real disk space; the count cap is not a byte-size
guarantee for unknown-size media. Existing jobs finish if a limit is lowered.

Staging paths and directories persist in the additive queue migration. Interrupted transfers reuse
their directory; downloaded files resume processing. Pre-migration active jobs retain their legacy
staging layout. The import transaction records its queue ID with ownership/history, so cleanup or
restart after a successful Move cannot trigger another download of the moved source. Missing staged
files resume a direct transfer or external-client status check, never an automatic external resubmission.

Queue distinguishes finding formats, downloading, merging, waiting for validation, validating and
importing. Processing bars are indeterminate rather than implying 100% end-to-end completion.
Completed/failed results retain measured stage timings and the last reported transfer speed.
Format extraction includes pre-transfer setup; merge timing includes post-processing/file movement.
Processing wait runs from transfer completion to processor start; validation elapsed includes any
wait for the shared motion worker. Total includes queue wait and restart downtime. Unknown stages
are omitted rather than reported as zero. Source validation, ignored checks, metadata rollback and
exact target-server confirmation still apply.

## Download efficiency update (2026-10-12)

The acquisition sequence still requires source acceptance, eligibility checks, bounded download,
full-video validation and atomic import. CPU-intensive motion validation shares one worker across
downloads and discovery samples. That release used one decode/filter thread and shared acquisition
slots; the newer pipeline above supersedes its slot/thread policy while retaining bounded work.
Subprocess and network deadlines produce recoverable failures; uncertain external submissions retain
their reservation and require verified reconciliation rather than automatic resubmission.

After import records awaiting-server status, a notification is scheduled outside the acquisition slot.
Imports within five seconds share one connector notification; subsequent automatic notifications are
spaced at least thirty seconds apart. In-flight refreshes are shared with delivery reconciliation.
The five-minute pending-import job recovers notifications interrupted by restart or server outages.
Only matching target-server inventory confirms delivery, as before.

Move staging hardlinks video bytes when supported on the same filesystem; supplied sidecars are
copied before metadata edits. The source remains intact until commit, and rollback restores any
replaced bundle. Cross-filesystem or unsupported hardlinks fall back to copying.

The sidebar polls active records and exposes initial loading and request errors. Progress consumes
complete output lines, including split/batched lines, and database updates are serialized/coalesced.
Monitor logs report all sources' queued, transferring, validating/importing and unresolved counts,
with historical failure records clearly separated from this-pass external-client outcomes.

Reviewed 2026-10-10 against main `10f8352`, product vision, workflow documentation and current code.
This is a review baseline, not a claim that the gaps below have been fixed.

## Change rule

Before changing a workflow, identify its entry point, required stages, completion condition,
failure recovery and return destination. If a request would reduce an established four-stage
flow to two stages by skipping required work, explain what would be skipped and ask the user
whether those stages should be preserved, automated or intentionally changed. Do not silently
drop identity validation, uncertain-content review, ownership checks or server confirmation.
Stages describe outcomes; they do not imply an equal number of manual clicks.

## Established flows

| Flow | Required sequence | Complete when |
| --- | --- | --- |
| Add an artist from Library or Discover | Select and validate MusicBrainz identity → save/reuse the canonical Library artist, even with zero videos → collect IMVDb, linked YouTube channels and local-file evidence → present the catalog and unresolved candidates for review | The artist is visible, collection outcomes are known and pending review is clearly identified. Acquisition is a separate flow. |
| Review an observed artist | Preserve the original observation → search/rank MusicBrainz identities → confirm or link to an existing canonical artist → collect sources and expose video-review work | The identity and provenance are retained without creating duplicate canonical artists. |
| Acquire a video | Review/accept the video and source → check ownership, ignored state and acquisition eligibility → enqueue and download within the shared concurrency limit → validate and import the video/sidecar bundle | The import succeeds. Server delivery still requires its own confirmation. |
| Deliver to a media server | Resolve the root's playback-library mapping → place video and metadata in the standard structure → notify/refresh the target server → reconcile the exact delivered file with target-server inventory | The intended server confirms the delivered copy. A local file or refresh acknowledgment alone is insufficient. |
| Generate a playlist | Choose the playback library, active rules, count and order → Generate refreshes inventory, saves membership and publishes to the chosen server → report publication outcome | The selected server has the playlist, or the saved playlist exposes a publication failure and retry. Local creation alone is insufficient. |
| Connect a media library | Configure/test credentials → select libraries and map roots → synchronize observations and inventory → review uncertain identities and ownership | Selected inventory is synchronized and unresolved review work is visible. Passing a connection test alone is insufficient. |
| Enable Last.fm reporting | Configure application credentials → authorize/link the account → explicitly enable scrobbling → observe eligible music-video playback and submit | Qualifying observed playback is reported to the linked account. Historical play counts are not backfilled. |
| Use YouTube account cookies | Obtain a session for an account with access → upload the Netscape cookie file → request an eligible video → inspect success or replace expired/unauthorized cookies | The account can access the video and the request succeeds. A saved-cookie indicator does not prove access. |

Discover's acquisition actions must return to the preserved Discover context. Library addition
must make the saved artist discoverable without requiring source collection to create its first
catalog video. Authoritative IMVDb entries can enter the catalog automatically; uncertain YouTube
and local candidates retain the established Video Review decision.

## Current gaps, in priority order

1. **Artist-add visibility and progress.** Library addition invalidates its queries, but retains
   the old search, filters and page and only closes the add form. A newly saved artist can be
   outside the visible results. There is no immediate reveal or clear collection-in-progress
   state in Library. Artist detail opened from Library does not poll background collection;
   its inventory-summary query also has no polling. Zero-video canonical artists are already
   supported by the backend; the missing work is presentation and observable progress.
2. **Source-check recovery.** Collection writes a checked timestamp even after provider errors;
   backfill selects only artists with no checked timestamp. A failed/partial check can therefore
   leave the automatic backfill queue without retry. The artist-add background chain also stops
   collection if preceding enrichment throws. Separate attempt/success state, independent
   provider outcomes and retry scheduling are needed.
3. **Uncertain external submission recovery.** `submissionUnknown` intentionally holds a
   concurrency slot to avoid duplicate submissions. Queue exposes refresh and history, but no
   explicit action to reconcile an unknown submission or safely release it after verification.
   Recovery needs an end-to-end operator path, not a blind retry.
4. **Completion labels.** Queue completion history records successful imports. Media-server
   confirmation happens later. Show imported/awaiting-server and ready-to-play outcomes distinctly.
   Transfer/import stage reporting should also match the actual work; current direct transfers
   can remain labeled downloading through import.
5. **Consistent next actions.** Playlist publication is already a separate Push action, and
   Last.fm enablement is already explicit. Carry this clarity across artist collection, pending
   video review, failed acquisition and pending delivery: show what completed, what remains and
   the action that resumes the flow. Do not equate configured, authorized, synchronized and ready.
6. **Operational traceability and log protection.** Source checks lack a shared run/stage trace
   that explains automatic versus manual execution. Error messages can be stored directly in
   activity/scheduler logs, and the main logger has no centralized redaction configuration.
   Add sanitized structured stage outcomes and centralized secret redaction. This is a protection
   gap, not evidence that a credential leak has occurred.

## Brandi Carlile observation and bounded log audit

The confirmed Brandi Carlile identity was found by Library name search, with one catalog video,
two linked YouTube channel records and 121 pending candidates at inspection. An older unmatched
`brandi carlisle` observation remains separate for Artist Review. These snapshots do not prove
which collection action ran automatically or which Library filters were active when she was added.

No configured-secret matches were found in 5,000 activity records and 2,665 lines from the current
container. The check covers those records and known configured secrets; it is not a guarantee
about all historical logs, unknown secrets or memory/resource leaks. Credentials and raw logs are
not reproduced here.

## Verification expectations for future fixes

Test the complete affected flow, including an interrupted/failed stage and recovery. For artist
addition, verify visibility before collection finishes, zero-video artists, filters/pagination,
provider failure/retry, reuse of existing identity and preservation of uncertain review candidates.
For delivery, verify import and target-server confirmation separately. For a workflow shortcut,
record where each original required stage now occurs before calling the shorter flow complete.

## Implementation following the review

The follow-up change addresses gaps 1–6: immediate artist reveal, New badges, visible collection/review
state, persisted attempt/success state and ten-minute retries, provider continuation and run tracing,
guarded Queue reconciliation, import-versus-server labels, review/retry links, explicit playlist
publication guidance and centralized diagnostic redaction. The default-on empty-artist filter applies
the user's exact available/known/unmatched zero-count rule. Addition disables it for the reveal view.
The baseline findings above describe the pre-change implementation. Required identity and uncertain
video review stages remain in place; connection and Last.fm authorization/enablement remain distinct.


## Unified Live workflows (2026-10-18)

The [live implementation](live-implementation.md) extends the established flows without changing
music-video canonical eligibility or removing required stages.

| Flow | Required sequence | Complete when |
| --- | --- | --- |
| Discover live material | Confirm shared artist → choose bounded history/date/tour scope → preview request range and budget days → discover candidate sources → review exact event and actual moving video | Candidate identity/content are accepted for every linked performance; a setlist reference alone is insufficient. |
| Acquire/import live recording | Accept source → check ownership, pins and exclusions → approve full indexer pack if needed → shared Queue/transfer → frozen validation choices → register original ordered parts | Import succeeds; retained staging remains available when a later part fails. |
| Register existing live inventory | Review identity/video → choose exact local file or server item → validate eligible file or verify authoritative server inventory → register in place | Local ownership or exact server ownership is recorded honestly, without moving files or inventing local paths. |
| Deliver live parts | Use configured live root and connector/library → import metadata bundle → refresh server → reconcile exact paths | Every intended part is confirmed by the target library; outage preserves earlier facts. |
| Review song coverage | Choose specific occurrence and part → verify start/end/full rendition → distinguish known-song coverage, reference completeness and continuous performance | Only the verified coverage is used for song playback/counters and safe version comparisons. |
| Use live playlist items | Choose bound static playlist → whole part or explicit unsupported-segment fallback → review mixed order → Push → confirm publication | Target server confirms publication; an unchanged previous playlist remains when a push fails. |
| Resume live viewing | Select server user/client and original recording version → send verified part/offset command → observe actual playback | Resume command is sent; watch credit and completion depend on later observations, never the command itself. |
| Correct classification | Flag music video → review same artist/event and moving video → reuse capture/file/count/playlist identities | Classified recording is available without file moves or reacquisition. Reverse only after normal official music-video eligibility review. |
| Remove recording | Review exact recording/rendition/artist-set scope → honor warning/exclusion settings → five-minute delay → verify targets and idle playback → remove local/server copies → retain event/viewing history | Exact selected copies are removed; failures or playing/paused sessions retry after 40 minutes. |
| Clean up redundant version | Explicitly enable suggestions → replacement validated and delivered → prove redundancy and check pins, coverage, playlist/resume dependencies → confirm deletion → normal delayed deletion | Older selected copy is removed only through normal deletion safeguards. |

Queued recording category and destination are assigned on enqueue; optional validation choices are
loaded when processing starts and retained throughout that attempt. Recovery retries staged bytes,
not an uncertain external submission. Provider errors are not empty results. Reference corrections
and later links preserve local IDs and user details until reviewed. Neither retention nor removal
of a performance implicitly deletes media or indefinite playback history.

Review recovery corrections (2026-10-18): existing-file registration resolves the physical path
before ownership checks. Both music-video and Live deletion verify other catalog owners of every
local target before remote deletion or unlinking; aliases stored by older versions block deletion
for review rather than silently changing ownership. The normal five-minute delay and 40-minute
retry remain in force. New music-video filter generation/regeneration excludes classified Live
compatibility rows; saved playlist references remain intact until explicitly edited/regenerated.

Delivery checks revisit retained server-only identities even without local paths and restore only
an exact unique item/path match with compatible known duration. Local pending deliveries and
availability audits page by stable ID, so unmatched first batches do not hide later entries.
Failed playback observations clear continuity, retaining earned time and resume state; the next
successful snapshot establishes a baseline before further watch credit. Automatic acquisition
uses the monitoring rule's selected source; indexer packs still require their normal approval.
The global exclude-deleted toggle also controls Live discovery, review and import checks without
discarding its ledger. Upper-bound-only history monitoring pages complete provider history and
filters dates locally, repairing older upper-year cursors; bounded year ranges retain their
year-by-year traversal, provider cache, budgets and retry behavior.


## Owner password recovery (2026-10-18)

Sign in → Forgot password? → provide the existing integration API key as ownership proof → enter
owner username, new password and matching confirmation → authenticated credentials update →
return to sign-in with an explicit success message → sign in using the new password. Invalid proof
or a failed request stays in recovery with an actionable error; no success is implied. Recovery
proof remains in form memory, is sent only in the protected API header and is cleared on completion
or leaving the form. Passwords remain salted hashes on the server. No unauthenticated reset route,
email link, new bootstrap window or API-key rotation is introduced.

If the key is also lost, a server administrator can run `recoverOwnerLogin.js --yes` in the local
console → generate a replacement password for the existing owner → sign in → choose a personal
password under Owner account. The command preserves library, API key, Google sign-in and connector
configuration; it makes no change without explicit `--yes`, and never claims a new installation.
Required ownership proof and successful normal login remain distinct stages. Authentication
factory reset remains a separate, broader recovery operation.

Verification: 62 focused authentication/recovery tests pass under Node 22, including invalid
ownership proof and preservation of settings/library identity. The production server/web image
build passes. A disposable runtime verifies CLI refusal without `--yes`, replacement password
login and rejection of the previous password; browser checks verify the reset form and return
to sign-in. Production deployment preserves the existing configuration volume and credentials.


## Jellyfin metadata and MTV enrichment (2026-11-04)

Successful nonempty selected Jellyfin video scan -> durable batch (or retained follow-up) ->
inspect typed selected-library items, locks and NFO fingerprints -> collect bounded evidence ->
fill unique verified missing fields or retain uncertainty for identity/video/field review ->
guarded native metadata/NFO write with backups -> targeted owned ASS generation/registration ->
verify read-back and track -> record updated/complete/review/unknown/failed outcome. Settings / MTV
Metadata provides progress, evidence and pause/resume/retry. Pause/cancel takes effect after the
current item; applied facts remain. Native checkpoint conflicts require inspection and a fresh
batch. Scope changes pause rather than redirect old work. Provider failures retain saved proposals
and request UUIDs for retry. See [metadata enrichment](metadata-enrichment.md).
