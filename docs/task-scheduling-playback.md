# Task scheduling and current playback

## Automatic library maintenance

System / Tasks includes Library Sync, defaulting to daily at 03:00 America/Chicago.
Its automatic window defaults to 02:00–10:00. The heavier identity, genre, catalog,
discovery, metadata-enrichment, playlist-regeneration, upgrade/backlog and log-cleanup
jobs receive that same window. Playback Monitor, resume/scrobbling, download progress,
delivery and deletion checks retain their ordinary all-day operation.

Every active task has Edit schedule. Choose a daily wall-clock time or an interval,
an IANA time zone, an optional automatic window, and whether automatic runs are enabled.
Intervals range from one second to 2,147,483,647 milliseconds. Windows can cross midnight;
the closing minute is excluded. A daily start must be inside its window. Saving validates
the complete schedule, preserves run history and reschedules the live timer immediately.
The table shows the next scheduled run in the task's selected zone. Run Now remains an
explicit immediate action outside the automatic window. An already-running task is not
started a second time.

Workers with pending-work support expose Keep working while pending work remains.
When selected, they continue their existing bounded follow-up batches inside the window.
Turn it off to run one batch per scheduled start. Disabling automatic runs or reaching
the window boundary prevents another automatic batch; active work finishes safely.
Pending enrichment and discovery progress remain saved for the next allowed run.

Daily schedules follow local time across daylight-saving changes. A nonexistent start
runs at the first valid minute after the gap; the repeated fall-back hour runs once.
The next deadline is persisted with a running claim before scheduled execution. A restart
recognizes interrupted work and retries at the next permitted time. Missed work waits for
its allowed window. Editing a task or restarting the scheduler cancels superseded timers.

Manual and scheduled library syncs use the same pipeline: validate connector/scope and
claim its sync slot; read the selected audio library and optional embedded tags; preserve
observations and establish identities; reconcile video inventory and native counts;
queue the established enrichment flow; refresh recommendations; then record success.
Video-only connectors omit the unselected audio source. Empty responses preserve prior
inventory. Failure is recorded per connector and other enabled connectors continue.
Overlapping connector/video snapshots are excluded. Interrupted scan flags are recovered
at startup so a failed process cannot leave synchronization permanently unavailable.

Full video snapshots also refresh local-file count caches from confirmed server IDs.
The root's primary connector supplies the cache; unmapped roots use the maximum known
confirmed count across enabled current-library copies. Copies are never summed, unknown
values stay unknown, and uncertain matches cannot populate a file count.

## Now Playing and per-video counts

Playback Monitor is independent of Last.fm and runs every 15 seconds by default, all day.
It reads Jellyfin's active session list and joins only known available copies in the
connector's selected video library. It performs no library enumeration. The global
Now Playing panel refreshes every five seconds and identifies the video, player/user and
paused state. Manage video opens the exact artist/video fragment beside the existing
Live/Concert and deletion controls. Accepted Live copies open their recording; uncertain
matches lead to Library Connectors review rather than a guessed canonical entry.

A stop, next-item transition or repeat-play transition saves a refresh for the previous
video's exact server ID. The connector's selected Jellyfin profile owns the native count.
Other profiles can appear in Now Playing while leaving that profile's count unchanged.
One queued video per connector is read each tick. Its actual UserData.PlayCount is copied
to Vidarr inventory and the appropriate confirmed file/Live-copy cache. Duplicate signals
and multiple players read the same accumulated native value; they do not add another play.
An actual zero is imported as zero. Missing counters remain unknown.

A video snapshot excludes item-count writes until its inventory transaction finishes;
audio/artist metadata work does not block per-item refreshes. Late responses are checked
against the current server/profile/library/credential scope before writing. Source changes
invalidate old-context session and refresh state. New inventory and confirmed delivery
stamp their selected library explicitly; the additive migration preserves legacy rows'
existing connector-library association.

Session observations and pending single-item retries survive restarts. Transient failures
back off up to 15 minutes. A confirmed missing server item retires its pending read. An
unchanged counter is rechecked briefly for a late server commit. Failed session reads do
not imply a completed video. Stale observations are labeled Last seen playing with their
observation time; a disabled monitor is labeled explicitly. Clips that start and finish
entirely between samples may be missed; scheduled full sync imports the native history.

Static playlist membership stays a saved snapshot. Count changes affect the next rule
calculation; smart playlists regenerate and publish on their configured schedule. Existing
identity/content review, validation, publication and deletion safeguards remain in place.
Historical qualification counters and the retired HTTP 410 webhook remain inactive.
The feature requires no Jellyfin/Roku/plugin restart and never writes Jellyfin play history.

## Verification

The playback tests run the real provider/client against a local HTTP stand-in. They verify
request paths and authorization, exact-ID count copying, repeat/paused/multiple-user playback,
unknown/zero values, outages, backoff, scope changes and restart recovery. Calls are limited
to /Sessions and a single user/item endpoint; a whole-library request fails the fixture.
These checks establish the integration against the exercised responses. Real server reads
confirmed the original gap: Jellyfin had counted watched playlist items that Vidarr still
stored as zero. After deployment, verify the actual Now Playing feed and native count data
without manufacturing a viewing for a test.
