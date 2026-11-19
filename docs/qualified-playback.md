# Server play counts

Jellyfin and Plex are the only sources of catalog play counts. Synchronize selected video
libraries and native counts through Library Connectors and Library Sync (daily at 03:00 America/Chicago by default).
Jellyfin Playback Monitor also refreshes one exact item after a playback transition, normally within
about 15 seconds. It copies the selected profile's native count without a whole-library scan.
Vidarr displays known counts, including a real zero, and leaves unavailable values unknown.
A local file's cached play count is a synchronized server value, not a Vidarr-derived counter.
Minimum-play rules reject unknown counts; Unwatched requires a known zero in the selected library.

Vidarr qualification polling, thresholds, UI and public counter fields have been removed.
Existing playback-webhook destinations should be removed from Jellyfin: the authenticated endpoint
now returns HTTP 410 and never creates a viewing or increments a counter. Obsolete scheduler
entries are hidden and never run. No Jellyfin/Plex installation or restart is required.

Live resume/viewing observations remain available and retain progress indefinitely. They never
increment performance or song plays. Mark finished only closes a viewing. Last.fm scrobbling
retains its independent account authorization and watched-time eligibility; it is not a play count.

Historical qualified-counter columns, observation rows and archived evidence are retained only as
inactive rollback data. The playback monitor uses separate additive observation/retry tables;
retirement history is preserved without media deletion or historical-data cleanup.
These values never appear in API responses, UI, playlist rules or active count policy.
See [task schedules and Now Playing](task-scheduling-playback.md) for cadence, retry, scope and freshness details.
