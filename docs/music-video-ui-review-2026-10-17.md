# Music-video UI review

Reviewed 2026-10-17 against the deployed local release `a2d53ea`, with source inspection for
workflows whose actions would create downloads, change configuration or publish playlists.
This is a recommendation record, not authorization to change product rules.

## Recommended order

1. **Make the next action obvious.** Use the same short states on Library, artist, Queue and
   playlists: Needs review → Ready to download → Downloading → Validating → Imported → Waiting
   for playback server → Ready to play. Keep ownership, monitoring and source confidence as
   separate badges. Link an error to the affected video/source, with an actionable explanation
   and technical details in a disclosure. Queue currently sends failures to the whole artist page.
2. **Make the review backlog manageable.** The inspected Video Review page showed 33,407 pending
   candidates and 669 pages. Add artist, source, content type and reason filters, sorting, and
   saved views. Group obvious audio, interview and behind-the-scenes candidates for review,
   showing why they were classified. Preserve individual evidence and restrict bulk acceptance
   to candidates that pass the agreed identity/content checks. Offer Send to live review for live
   footage once that workflow is ready. A larger Accept all control would compound the problem.
3. **Clarify Library scope.** The inspected header said 394 artists while Hide Artists w/o Videos
   was active. Show “394 matching artists” and the complete Library total separately. Put active
   filters in removable chips, provide Reset view, and retain an immediate reveal/Open artist
   action after adding. Place advanced filters in a disclosure; make genre searchable rather
   than a several-hundred-option native list.
4. **Reduce artist-page density.** Lead with available/known, missing, needs review and the next
   action. Use a compact video table with searchable status filters and expandable details.
   Keep director, provenance, server identifiers and diagnostics in details. Group monitoring
   actions under one menu; label Search and Download consistently (currently Grab also appears).
   Put Delete and Live/Concert classification in a row menu rather than beside every title.
5. **Make warnings distinguishable and specific.** Adele's inspected rows repeatedly said
   “Removed from latest IMVDb catalog — review,” including locally owned/server-confirmed videos.
   Distinguish source absence from missing media and failed acquisition; show source timestamp,
   retained ownership and Review evidence. Investigate why the catalog message repeats before
   changing its underlying matching behavior. Do not imply those files vanished.
6. **Give Queue summary tabs and recovery actions.** Add counts for Waiting, Downloading,
   Validating/importing, Needs action, Waiting for server and Ready. Retain move-to-top and ordering
   for waiting items; add an explicit priority handle or menu. Show failed rows with Change source,
   retry retained file, or reconcile submission as appropriate. Do not resubmit uncertain jobs.
   Keep useful stage timing details collapsed. Separate historical completion from current readiness.
7. **Turn playlist creation into a visible handoff.** Preserve Generate → review → Push → confirmed
   publication, but keep a persistent draft/publication badge and a direct Open and review action
   after generation. Put common controls first; collapse advanced rules. Replace the thousands-of-
   artists multi-select with searchable selection. Make “unwatched” and minimum play count clearly
   distinguish qualified Vidarr plays from server-reported counts, including unknown/stale values.
8. **Explain import decisions before committing.** Import currently describes guessing an artist
   from titles/uploading channels. Show guessed artist beside the MusicBrainz-confirmed identity,
   confidence and required correction. Explain validation stages and selected category policy in
   the preview, as well as what Add to watch list authorizes. Never treat the uploader as proof of
   the performing artist.
9. **Organize settings by outcome.** Keep Validation/Quality together, explanations next to each
   choice and quality profiles at the bottom as requested. Show effective settings for Imported,
   Canonical and Additional videos in a compact comparison, with mandatory Import/Delivery checks
   shown as always on. Explain that queued jobs use settings when validation starts. Keep deletion
   confirmation and future-scan exclusions adjacent. Surface connector reachability, last success,
   selected library and incomplete delivery in one status area.
10. **Improve interaction accessibility.** Use consistent focus states, larger row targets,
    explicit button names, visible labels and status text independent of color. Test table/card
    behavior at narrow widths and 200% zoom. Distinguish loading, empty library, filtered-empty and
    request failure; avoid showing Queue is empty while requests are still loading.

## First reviewable implementation batch

Start with the shared status/next-action presentation, Library filter scope, artist video-table
layout and review backlog filters. Preview these together using existing data, then implement
Queue recovery and playlist publication polish. Keep behavioral/matching changes separately
testable; a visual cleanup must preserve validation, review and confirmed delivery.

The review used read-only navigation. No production downloads, review decisions, deletions,
configuration changes or playlist publication were performed.
