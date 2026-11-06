# MTV Music Video Info — Jellyfin plugin

Separate server component for **Jellyfin 12.3.0 / .NET 10**. Vidarr does not install or load it.
The archived native Roku/Web prototype is unrelated and remains excluded from application builds.

## Scope and activation

Only Jellyfin items typed `MusicVideo` in selected music-video libraries qualify. The plugin
generates owned ASS tracks, then a playback-negotiation action filter selects that track for
eligible primary local files. It changes both query and body selection arguments before the
normal Jellyfin action runs, so the existing transcoder can burn it into the requested stream.
Version 0.1.1 also supplies the eligible primary source ID when Web omits it: Jellyfin otherwise
ignores the requested subtitle index. Explicit alternate/unknown sources still pass through.
It never changes user subtitle defaults. Movies, episodes, generic videos, audio, unselected
libraries, alternate/unknown source IDs and unowned subtitles pass through unchanged.

When active, the generated info track takes priority over ordinary subtitle selection on those
music videos. Use the plugin's enable switch to opt out. Burn-in can require video transcoding;
normal Jellyfin transcode storage/performance limits apply. Playback still occurs in the standard
client. Compatibility with other server versions and every Jellyfin client is not established.

## Build and artifact

```powershell
.\integrations\jellyfin-mtv-plugin\build.ps1
```

Requires Docker and the official `mcr.microsoft.com/dotnet/sdk:10.0` image. It references the exact
installed Jellyfin assemblies read-only, compiles/tests in the container's temporary filesystem,
and exports only `.artifacts/Jellyfin.Plugin.Mtv.dll`. No Jellyfin runtime DLLs are bundled, no
NuGet packages are needed, and the primary Vidarr Docker context excludes this whole component.
The installed runtime path defaults to `C:\Program Files\Jellyfin\Server` and is configurable.
Do not treat an arbitrary newer SDK/plugin-template ABI as compatible with the target server.

## Administrator setup

1. Install the built DLL in a dedicated directory under Jellyfin's plugins folder using the
   normal plugin process, retaining any prior version and configuration. Restart Jellyfin when
   playback is idle. An installation/restart is distinct from source build success.
2. Open Dashboard → Plugins → **MTV Music Video Info**. Default activation is off and no libraries
   are selected.
3. Select only the desired music-video libraries; save timing/text-size settings.
4. Click **Generate / refresh info tracks**. Progress and up to fifty errors are shown. Generation
   is paged in batches of 100, and cancellation/restarts preserve previously generated tracks.
5. Wait for generation and owned-track registration to finish. Enable automatic selection
   and save, then test a video from the beginning in the standard client with ordinary subtitle
   defaults unchanged.
6. Regenerate after adding music videos, changing their metadata, or changing rendered timing/style.
   This first version does not silently generate on every library event.

Version 0.1.2 registers the owned track using Jellyfin's public `IMediaStreamRepository` rather
than queuing full metadata refreshes. It appends a new stream index without renumbering video,
audio or foreign subtitle streams, and leaves existing owned stream records intact. Rerunning
generation also registers an unchanged generated file when its stream was not previously indexed.
Inconsistent or duplicate stream metadata is reported for review instead of being replaced.

Version 0.1.3 follows the supplied five-line reference: artist, quoted song title,
`Album - Album Year`, record label and `Director/s: Names`. The standalone video-year and trailing
MTV lines are removed. Text remains bold white with a dark outline at the lower left, visible
for six seconds at each end. Missing fields disappear; an unknown album year leaves the album
name without a dangling separator. No standalone year appears when the album is absent.

Artist/title/album/directors come from existing Jellyfin music-video metadata. Record label uses
the video's Studios metadata when available, otherwise the uniquely matched album's Studios.
Album year comes exclusively from a unique local MusicAlbum with the same album title and an
exact matching credited artist (case/whitespace ignored). Multiple editions, no album match or
missing artist evidence leave album year and album-derived label unknown. Generation reads local
album metadata in pages; it does not fetch metadata, change catalog records or treat video year
as album year. The earlier ProductionYear-only video-year rule is superseded by this requested
album-year presentation.

Kabel is embedded in the plugin DLL and in each generated ASS track's `[Fonts]` section.
No OS font installation, Windows font path or runtime download is required. The bundled freeware
digitization is Kabel Book, rendered bold, rather than the commercial Kabel Black face. Its source
and embedded attribution are retained in [the font notice](Jellyfin.Plugin.Mtv/Fonts/NOTICE.md),
also included in the package and DLL. The font adds about 23 KiB per generated track. Windows
Jellyfin FFmpeg and Linux FFmpeg/libass both select the embedded KabelBook in synthetic render
checks without system Kabel fonts. This establishes rendering portability, not compatibility of
the plugin with untested Jellyfin versions or native client subtitle renderers. Server burn-in
uses the bundled face; native rendering depends on the client's ASS support.

After upgrading, regenerate owned tracks to apply the new layout and font. Keep the existing
ownership manifest and revision backups. Upgrading the DLL alone does not rewrite existing tracks.
The 0.1.3 exact-version Docker build has zero warnings/errors and all 49 core checks pass.
The isolated Jellyfin 12.3.0 integration also passes bundled-track generation/registration,
explicit and omitted-source automatic selection, movie/episode exclusion, disabled recovery,
administrator authorization and preservation of source bytes, stream indexes and user defaults.
Verified DLL SHA256: `9c6736aa62586d2d49afca917799237c9c3754fc70dc2f502103a46b0eaf5c84`.
The package is `.artifacts/MTV-Music-Video-Info-0.1.3.0.zip`. On 2026-11-04 the verified DLL and
manifest were installed under production `plugins/MTV Music Video Info_0.1.3.0`, retaining prior
versions. The user authorized interruption for restart, then stopped the automatically resumed Roku
playlist because that client does not support remote Stop. With playback idle, generation processed
4,274 items: one created track, 4,270 revisions backed up and three known unreadable files skipped.
All 4,268 valid real-library videos and three synthetic controls have indexed tracks; automatic
selection is enabled. Sampled explicit/omitted-source requests pass, movie/episode controls receive
no overlay, and user configuration, libraries/playlists and original media attributes are preserved.
The 4,270 original media-file size/timestamp checks all pass. No new physical Roku display check
was performed; Windows/Linux synthetic render evidence and earlier client evidence remain distinct.

Current private recovery files are `.artifacts/production-baseline-20261104.json`,
`production-rollout-state-20261104.json`, `production-rollout-20261104.mjs` and
`production-activation-verification-20261104.json`. Use this dated verifier and snapshot together;
the repository's original operator script and October snapshots target the historical 0.1.2 rollout.
Short overlapping windows merge; unknown/unscanned duration is an error, not an invented outro.

## Data preservation and recovery

Generated sidecars are named `<video basename>.mtv-info.eng.ass`. A content-hashed ownership
manifest lives under the plugin data folder. Existing unrelated same-name subtitles, or owned
files edited outside the plugin, are not overwritten. Unchanged generation is idempotent; prior
generated contents are backed up before revision. Video bytes are never re-encoded or copied.
An interrupted manifest write may require ownership review; playback falls back normally rather
than trusting an unrecorded file. Source file permission failures are reported per item.

Disable activation to stop automatic overrides. Generated tracks remain available for manual
selection; disabling/uninstalling does not delete media or sidecars. Keep the plugin data folder
and backups if removing the DLL. Any later cleanup must verify exact manifest paths/hashes and
preserve externally modified files; there is no automatic destructive cleanup endpoint.

## Verification status

The exact-version build succeeds with no warnings/errors. Thirty standalone core
tests pass, including positive music-video eligibility and negative movie/episode/audio/generic
video controls. The final live isolated-server integration pass confirmed music-video automatic
selection with user subtitles None, unchanged movie/episode playback, preserved defaults/source
bytes, and normal negotiation after disabling. Anonymous and ordinary users cannot access the
administrator controls. The saved report is `.artifacts/lab-smoke-report.json`; the verified DLL
SHA256 for version 0.1.2 is `70493b6e07bcef880dbbc88aa96bf9fec444c29da396122837790ffa37af0ff1`.
Its isolated integration pass includes both explicit source IDs and Web's omitted-source request.
The final 0.1.2 lab pass also verifies direct registration of a fresh control and unchanged existing
audio/video/foreign-subtitle indexes and bytes. Run `prepare-index-fixture.ps1` before that suite.
Run `package.ps1` to create `.artifacts/MTV-Music-Video-Info-0.1.2.0.zip`.
On 2026-10-25 the user confirmed titles appear at both ends in the official Roku app after
reopening the production test playlist without manually selecting subtitles. This verifies the
new plugin's automatic activation separately from the earlier user-default preselection POC.
Jellyfin Web 12.3.0 is also visually verified on 2026-10-25 with version 0.1.1: automatic intro
display, no middle display, and outro display after seeking. Screenshots are retained privately as
`.artifacts/web-intro.png`, `web-middle.png` and `web-outro.png`.
The initial Web test exposed the omitted-source problem; version 0.1.1 fixes that server path and
is active in production beside the retained 0.1.0 files. Restart was deferred during Roku playback
and completed only after the user stopped it and a fresh idle check passed.

This is not a universal media-server/client plugin. Exact-version build/server integration is
verified on Jellyfin 12.3.0 / .NET 10, Roku display on the official 3.2.4 app / 3810X, and Web display
in this Chromium-based browser. Other server versions, operating systems and clients require
their own checks. A client must render the selected ASS track or negotiate server burn-in, with
transcoding permitted and supported. Plex is outside this Jellyfin plugin's scope.

On 2026-10-31 production version 0.1.2 was confirmed active on Jellyfin 12.3.0 with the verified
DLL hash above; no restart was needed and playback was idle. The guarded `resume-index` pass
completed with activation off, processing 4,273 items: one created sidecar, five metadata updates,
4,264 unchanged tracks and the three known unreadable files below. All 4,267 valid real-library
videos and three synthetic controls have indexed owned tracks. Automatic selection is now enabled
for Music Videos and MTV Overlay Test. Sampled explicit-source and omitted-source requests both
select the owned track and offer burn-in; movie/episode controls receive no automatic overlay.
The original rollout snapshot is retained. A separate private dated snapshot adds the one newly
observed video, Architecture in Helsinki — Like It Or Not, after verifying that every original
inventory identity, path, library and duration is unchanged. The dated verifier adjusts only the
reported real-library count; all activation and preservation guards are retained. Private recovery
files are `.artifacts/production-library-rollout-state-20261031.json` and
`.artifacts/production-library-20261031.mjs`; use these together with the existing private library
baseline for subsequent verification. Do not use the old snapshot for this expanded inventory.
The exact-version Docker build again passed with zero warnings/errors and all 30 core tests.
All 4,270 original media files match their baseline sizes/modification times, and general user
configuration, original libraries and non-exempt playlists are preserved. No new physical Roku
or visual Web playback check was performed on this date; prior client evidence is recorded above.
The earlier 0.1.1 full metadata refresh queue was superseded by targeted registration. Two
concurrent playlist deletions were explicitly confirmed by the user; a separate private rollout
baseline excludes only those IDs while retaining the original historical baseline.
The preflight snapshot contains 4,269 real music videos plus
three synthetic controls. Three real MP4s lack a scanned duration and FFmpeg reports `moov atom
not found`: Analog Blumpkin, Tesla (They Might Be Giants), and Yo La Tengo — You May Be Right.
Preserve and skip these files; do not invent outro timing, repair them, or reacquire them implicitly.
Disable the plugin in its settings to stop automatic selection without removing generated files.

`production-test.mjs` is an operator-only bounded verifier run inside Vidarr so connector
credentials remain there. It requires the private POC baseline path, validates production identity
and exact synthetic library inventory, and requires `MTV_PRODUCTION_OVERLAY_TEST=1` for changes.
Its `enable-test` action refuses existing configured scope; `verify` only reads/negotiates playback;
`disable` turns automatic selection off. It neither restarts Jellyfin nor modifies user defaults.

`production-library.mjs` performs the separately authorized real-library rollout. Run it inside
Vidarr with the private POC baseline and a persistent private rollout-state file. `prepare` saves
configuration and exact item inventory without replacing an existing snapshot. `start` requires
`MTV_PRODUCTION_LIBRARY=1`, unchanged configuration and idle playback; it disables activation while
generating selected test/real-library sidecars. `status` reports progress. `activate` requires the
same flag, completed generation and indexing for every item with a known duration, plus unchanged
inventory identities, original libraries/playlists and user configuration. It then enables both
libraries and samples both request styles. `verify` repeats those read-only checks. Preserve state
and manifest/backups if interrupted. Restoring the saved `beforeConfiguration` through Jellyfin's
plugin configuration API restores the prior test-only scope without deleting generated sidecars.
After an interrupted 0.1.1 indexing pass, `resume-index` requires the same exact disabled rollout
configuration, idle playback and active version 0.1.2. It reruns generation/registration using the
existing ownership manifest. `activate` and `verify` also enforce that tested release, check movie
and episode controls, and preserve every non-exempt original playlist. New playlists are allowed.

`prepare-negative-fixtures.ps1` creates synthetic movie/episode controls inside the pre-existing
isolated POC lab, not production. `smoke-lab.mjs` checks the saved lab server identity before
changing fixtures/preferences and restores lab user configuration/disabled plugin state in
`finally`. Its only allowed server is the isolated port 18096. No production API key is used.

Admin routes are `/MtvOverlay/Libraries`, `/MtvOverlay/Status`, and POST `/MtvOverlay/Generate`.
They require Jellyfin's elevated authorization policy. The embedded settings page uses these
routes and the standard plugin configuration API; provider/library labels use text content.


## 0.1.4 metadata enrichment

Vidarr standard scans can fill verified missing Jellyfin/NFO metadata and refresh individual owned
tracks through the elevated `/MtvOverlay/Metadata` API. Item/library/path, locks, fingerprints and
ownership are checked before write-back. Request journals and original NFO backups live under the
plugin data directory. Explicit `<albumyear>` stays separate from `<year>`. Windows and Linux use
the same server-local writer and bundled Kabel. See [the workflow](../../docs/metadata-enrichment.md).
Production activation is a separate verified deployment, not implied by building this release.

## 0.1.5 completion verification

Metadata snapshots and completed request replays require both an intact owned ASS file and its
registered subtitle stream. A valid file whose registration disappeared reports `OverlayValid`
false and completed replay returns a conflict. A fresh request with a current fingerprint can
refresh/register the owned track without changing media bytes or user subtitle preferences.
The isolated enrichment smoke test removes the synthetic item's registration while preserving
ASS bytes, verifies rejection, and restores it with a fresh targeted request.

Production verification (2026-11-06): after the user-requested wait for idle playback, installed
0.1.5.0 on native Jellyfin 12.3.0 and verified active status, capability version and an existing
real owned stream. Sixty-four core and 25 isolated API checks passed. The prior plugin folder,
library/plugin configuration, subtitle defaults and playlists are retained. DLL SHA256:
`d198ede8bba6e82f031b61922512cc90a10e31988b25a7c0d9f7f26590bfa7fd`.
This is server verification, not an additional physical Roku test.
