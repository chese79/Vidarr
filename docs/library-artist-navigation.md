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

Identity confirmation, uncertain-source review, validation, import and server delivery requirements
are unchanged. Row candidate confirmation uses the existing reviewed MusicBrainz path. Visibility
does not rewrite artist IDs, merge observations, change monitoring preferences or create videos
or performances.

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
