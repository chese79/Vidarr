# Process flows and consistency review

## Transfer/processing pipeline (2026-10-15)

The required acquisition stages are preserved: accepted source and eligibility checks → transfer
and merge → full-video validation → atomic import → separate target-server delivery confirmation.
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
