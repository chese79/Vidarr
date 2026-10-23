# Native MTV overlays for Jellyfin

**Paused future development.** These sources are archived separately from the active application.
Do not install or include them in current Vidarr or Jellyfin deployments. Existing ignored build
artifacts remain at their old local location; no deployed client was changed by this archival move.

Two optional **client source components**, installed independently of Vidarr and of each other.
They draw a literal `MTV` block at the lower left over the original music video, using Jellyfin's
imported item metadata. They do not change a playback URL, request a transcode, render/copy media,
publish playlists, record plays or require a Vidarr connection during playback.

This is not a Jellyfin server plug-in. The standard Roku store app cannot load these files.
Rebuilding Vidarr does not install either client component.

## Supported source bases

The checked source revisions are deliberately pinned. `bases.json` records normalized SHA-256
checksums of every integration target. The installer checks **all** affected files before writing,
refuses incompatible/edited files, supports a dry run and saves exact originals for removal.
Other Jellyfin versions need an explicit port and rebuild; do not bypass the checks.

| Client | Source revision | Build runtime |
| --- | --- | --- |
| Jellyfin Roku 3.2.5 development source | `72cfe985d4567e40f98dc098490a73eb141de85a` | Node 22 |
| Jellyfin web 13.0.0 development source | `ee8efb417e5377ba444509a68ed22af33e45950b` | Node 24, npm 11 (upstream requirement) |

These are source compatibility targets, not a claim that either development version is the
version installed on your server/device. Vidarr itself retains its supported Node 22 runtime.

## Install the web component

From a separate clone of [jellyfin-web](https://github.com/jellyfin/jellyfin-web), check out the
revision above. Use absolute paths in place of the placeholders below. The installer is run from
this directory with Node 22 or newer; client compilation uses the runtime in the table.

```sh
node install.mjs install web /path/to/jellyfin-web --check
node install.mjs install web /path/to/jellyfin-web
```

In that Jellyfin web checkout:

```sh
npm ci
npm run build:production
```

Deploy its `dist/` as the web client for a compatible Jellyfin server, following that server's
normal custom-web build procedure. Back up the original web assets and preserve server configuration
and media. This package does not locate/overwrite a live Jellyfin installation automatically.
Clear cached web assets/service worker after replacement so the browser loads the matching build.

In Jellyfin web, open your user **Playback** settings, enable **MTV music video overlay**, and save.
The setting defaults off and is stored for this browser/client through Jellyfin's existing
app-settings mechanism. Start a music video. Native video fullscreen (notably iOS), browser video
picture-in-picture, external players and casting cannot display a sibling DOM overlay; use the
normal Jellyfin player/fullscreen container. This component does not add support to those players.

## Install the Roku component

From a separate clone of [jellyfin-roku](https://github.com/jellyfin/jellyfin-roku), check out the
revision above, then:

```sh
node install.mjs install roku /path/to/jellyfin-roku --check
node install.mjs install roku /path/to/jellyfin-roku
```

In that Roku checkout:

```sh
npm ci
npm run build
```

Use the ZIP generated under `out/` with Roku's **Development Application Installer**, after enabling
developer mode on the target device. Follow [Roku's sideloading instructions](https://developer.roku.com/docs/developer-program/getting-started/developer-setup.md).
Sideloading installs a development channel and replaces any existing sideloaded development
channel; it does not modify the Jellyfin store channel. No device password is collected by this
package, and the installer does not enable developer mode or upload anything automatically.

Launch the development channel, connect it to your existing Jellyfin server and sign in normally.
Use that development channel for overlay playback rather than launching the store channel.

Open Jellyfin Roku **Settings → Playback → MTV music video overlay**, enable it, and start/restart
a music video. It defaults off and uses the Roku app's existing per-user setting storage. On-device
testing is required to confirm video/SceneGraph composition on the particular Roku model/firmware.

## Timing and metadata

- Intro: `0 <= position < 6`. Outro: `duration - 6 <= position < duration`, with positive known duration.
- Overlapping windows on videos shorter than 12 seconds form one continuous display.
- Follow media seconds through pause, buffering, seeks and resume. Initial buffering stays hidden;
  buffering after playback retains the current timeline display. Stop/end/error hides it.
- Only `MusicVideo` items qualify. Import videos as music videos in Jellyfin; a generic Movie item
  is intentionally excluded. Use `Artists`, then `ArtistItems`, then `AlbumArtist`; title is `Name`,
  followed by available `Album`/`ProductionYear`. NFO values must first be imported by Jellyfin.
- Unknown duration has intro only. Web transcoding offsets are included in position; an unknown
  full runtime on an offset transcode does not guess an outro from a shortened stream.
- Metadata is plain text and length bounded. No markup or filesystem/NFO paths are evaluated.

## Verification and removal

In this directory, using Node 22:

```sh
npm ci --ignore-scripts
npm test
```

Alternatively, from the Vidarr repository root, the standalone test image keeps dependencies
inside Linux rather than on a Windows bind mount:

```sh
docker build -f future/mtv-overlay/Dockerfile.test -t vidarr-native-overlay:test future/mtv-overlay
docker run --rm vidarr-native-overlay:test
```

`Dockerfile.roku` and `Dockerfile.web` likewise accept their respective **already patched client
checkout** as build context. Exclude `.git`, `node_modules`, `build`, `out`, `dist` and
`.vidarr-native-overlay.json` in that checkout's `.dockerignore`. Their outputs stay inside the
image at `/source/out/` (Roku) or `/source/dist/` (web); extract them from a temporary container.
These images are verification/build tools, not replacement Jellyfin servers.
The final web image contains only compiled assets; when creating a stopped extraction container,
pass a placeholder command (for example `docker create --name mtv-web vidarr-native-overlay:web unused`)
and copy `/source/dist/` without starting it.
The web image runs the full upstream TypeScript check before production bundling, then releases
that process and minifies serially with reduced module parallelism to fit a small Docker VM.
It preserves production optimization and minification; the overlay does not alter client build
configuration when installed into an ordinary checkout.

For the pinned-source installer round trips, set `MTV_UPSTREAM` to a directory containing `roku/`
and `web/` checkouts before running tests. Those checks use temporary copies and restore exact
original bytes, including CRLF. Other tests run independently of upstream checkouts. Roku logic
and player state transitions execute through the `brs` interpreter; this does not emulate a Roku
video decoder or SceneGraph compositor. Full upstream client builds are separate checks.

The installer writes `.vidarr-native-overlay.json` in each client checkout with original source
and installed checksums. Keep it for recovery and do not commit it to the upstream client repo.
To remove, then rebuild/redeploy the restored client:

```sh
node install.mjs remove /path/to/jellyfin-web
node install.mjs remove /path/to/jellyfin-roku
```

Removal refuses to overwrite files edited since installation. Reconcile/preserve those edits first.
After an interrupted source install/removal, run removal to restore files whose bytes still match
either the saved original or the installed version; unknown edits are preserved for review.
Re-running installation verifies an existing installation instead of duplicating hooks. Client
settings can also disable drawing immediately for the next playback without uninstalling.

Before release, test a real server and Roku: long/short/unknown-duration items; pause/buffer/seek;
resume into the middle/outro; consecutive playlist items; switching audio/subtitle tracks; stop/error;
long/missing metadata and TV overscan. Compare the playback method and reporting with the overlay
disabled. A successful build/unit suite does not establish device compatibility.
