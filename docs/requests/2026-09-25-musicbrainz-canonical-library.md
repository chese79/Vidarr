# MusicBrainz canonical library and IMVDb official catalog

Date: 2026-09-25  
Status: In progress

## Outcome

Vidarr builds its library from observed audio-library artists, resolves each artist to a stable
MusicBrainz identity, obtains the expected official video list from IMVDb, and only then reconciles
existing video files. A user's extra videos remain visible without changing official completeness.

## Authority and provenance

- Audio/media connectors and embedded Picard tags are observations.
- A direct MusicBrainz artist ID is confirmed identity evidence.
- Name/alias fuzzy matches are candidates; a name alone is not auto-confirmation.
- IMVDb is authoritative for the expected official music-video list.
- MusicBrainz recording relationships are supplementary metadata and source evidence.
- YouTube/VEVO and other URLs are acquisition sources, not catalog identities.
- Locally owned videos not found in IMVDb remain inventory-only records.

## Functional requirements

1. Import artists from selected audio libraries and artists credited by selected video libraries.
2. Consume connector-exposed MusicBrainz IDs and, later, direct embedded audio tags.
3. Store MusicBrainz match status, confidence, evidence, and review candidates.
4. Confirm direct IDs automatically. Present ambiguous, fuzzy, and name-only matches for review.
5. Enrich confirmed artists with canonical name/sort name, type, country, disambiguation, and genre.
6. Resolve confirmed artists to one exact IMVDb artist and refresh the official video catalog.
7. Import direct MusicBrainz video recording relationships as supplementary, unmonitored videos.
8. Reconcile owned videos only after catalog construction. Preserve unmatched artist inventory.
9. Compute known/available/missing completeness from active official IMVDb videos only.
10. Permit explicitly monitored supplementary videos to use verified direct sources; never acquire
    inventory-only rows automatically.
11. Apply the Library filter interaction model to Discover: URL-persisted search, alphabet rail,
    genre, match/monitor state, applicable minimum counts, result count, clear-all, select-visible,
    and bulk actions.
12. Organize Library by artist, with accordion video summaries and a thumbnail-rich artist detail
    page showing official, supplementary, owned, missing, downloading, and review states.

## Metadata precedence

Genre precedence is user override, embedded Picard tag, MusicBrainz genre, media-server metadata,
then folksonomy. Vidarr stores only observed releases/recordings rather than mirroring a complete
MusicBrainz discography. Artist channel links are discovery hints only; direct recording video
relationships may be retained as sources.

## Safety and compatibility

- The migration is additive and preserves artist, video, download, and file IDs.
- Existing IMVDb-linked videos become `official`; other existing rows become `inventory` and are
  set unmonitored so the authority change cannot trigger downloads.
- Connector sync failures never delete media or canonical artist records.
- MusicBrainz requests use a meaningful User-Agent and respect the one-request-per-second policy.

## Acceptance mapping

| Requirement | Implementation |
| --- | --- |
| Stable artist identity and review state | Prisma artist fields and `MusicBrainzArtistCandidate` |
| Connector MusicBrainz IDs | Plex, Jellyfin, and Subsonic library providers |
| MusicBrainz enrichment and candidate search | `providers/metadata/musicbrainz.ts`, `pipeline/artistIdentity.ts` |
| IMVDb-only official completeness | artist summary catalog-kind filter |
| Supplementary MusicBrainz videos | recording relationship import with verified sources |
| Preserve unmatched existing videos | `LibraryVideo` inventory plus `inventory` catalog kind |
| Identity review API | candidate list, discover, and confirm artist routes |
| Direct embedded tag scanner | Open |
| Bulk match-review UI | Open |
| Discover filter parity | Open |

## Verification

- Unit-test match scoring and the rule that exact-name-only matches require review.
- Test migration on a populated pre-change database.
- Test direct-MBID connector sync, IMVDb official catalog construction, supplementary import, and
  inventory reconciliation order with mocked provider responses.
- Run the complete server suite and production workspace build under Node 22/Docker.
