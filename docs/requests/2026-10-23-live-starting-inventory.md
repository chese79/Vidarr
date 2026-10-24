# Live starting inventory

Status: implemented and verified locally on 2026-10-23; not deployed.

Confirm the shared MusicBrainz artist identity, resolve its artist/VEVO sources, then collect
both music-video and Live discovery inventory independently of the selected browser catalog.
Live processing requires the installed capability and General enablement preference. Existing
Full installations default enabled for compatibility; disabling preserves all existing data.
Installation capability can independently be disabled with `VIDARR_LIVE_COMPONENT=disabled`.
This is a component activation option, not a new Slim/Full edition or a refactored code fork.

On first entry, offer up to five artists with discoveries. Opening an artist provides up to
five video candidates and five ranked MusicBrainz search leads, with explicit review/search
actions, progress/errors, dismissals and paged exploration. References do not create missing
video obligations or a performance backlog. Reference acquisition is bounded to the first 100
website-default Live release groups and 100 direct performer event relationships. Official
Live albums rank ahead of broadcasts, selected events, EPs and other references. Partial/failing
providers preserve earlier data, with a ten-minute retry cooldown and a three-artist background
batch prioritizing saved Live observations. A manually opened artist can refresh its shared channels using the existing collector.

setlist.fm is on request only. Artist addition, opening Live, shared collection, background
monitoring and stale metadata cursors must never query or traverse it. Its compatibility
scheduled entry point is retained as an inert status action. Each history page requires an
explicit artist-level button action; existing credentials, references and manual links survive.

Preserve distinct artist, source, recording/capture, performance, work and ownership identities.
Unknown date/place stays unknown. Release and publication dates do not become performance dates.
Opening a lead explicitly creates/reuses a pending independent/reference entry; it neither
searches nor downloads. Review checks performer/occasion and actual moving video; existing
validation, import and exact target-library delivery confirmation remain mandatory afterward.
No automatic cross-provider or title-only merging is introduced. Existing MV review decisions
remain unchanged; old automatic Live title exclusions may seed the separate Live inventory.

Verification must cover migration preservation, both-catalog source routing, enablement and
capability absence, repeat scans/dismissals, provider failure/recovery, default limits, scoped
promotion, date preservation, pending review/no acquisition, first-entry UI and zero background
setlist.fm requests even with configured credentials and pre-existing monitoring rules/cursors.

## Deferred follow-up — 2026-10-23

User requested that the artist's **Discovery and monitoring** panel default to open while
remaining collapsible, then explicitly asked to save the change for later. This default-open
change is pending and has not been implemented or deployed. Resume with LiveControls and its
workflow test; preserve the active existing-artist discovery batch during any future deployment.
