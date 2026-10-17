# Process flows and consistency review

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
| Create a playlist | Choose the playback library and refresh its inventory → choose active rules, count and order → generate/review membership → push to the chosen server and confirm publication | The selected server has the playlist. A saved Vidarr playlist is an intermediate result. |
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
