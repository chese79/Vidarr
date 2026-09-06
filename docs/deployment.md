# Deployment

Four ways to run vidarr, in order of how much setup they require. Pick one.

- [Docker](#docker) — recommended; bundles `yt-dlp`/`ffmpeg`, no host setup.
- [Local development](#local-development) — for working on vidarr itself.
- [Native Linux (systemd)](#native-linux-systemd) — a persistent service without Docker.
- [Native Windows (service wrapper)](#native-windows-service-wrapper) — same, on Windows.

Every path shares the same first-run behavior: vidarr generates an API key on first
boot and prints it to its own console/log output — copy that value into the web UI's
key prompt the first time you load it (see [`README.md`](../README.md#first-run-the-api-key)
for the full explanation and how to recover a forgotten key).

Every path also shares the same config loading: the server reads `apps/server/.env`
itself (found relative to its own file location, not the directory you launch it
from — so it works the same whether you run `node dist/main.js` from `apps/server`
or from anywhere else), and a real environment variable (set by Docker's `ENV`
instructions or systemd's `EnvironmentFile=`) always takes precedence over the same
key in `.env`. `WEB_DIST_PATH` only needs to be set explicitly when the built web
assets live somewhere other than the normal `apps/web/dist` next to the server —
Docker and the paths below all work without it.

## Docker

```bash
docker compose up --build
```

- App: `http://localhost:3434`
- `/config` (named volume) holds the SQLite database; `/media` (bind-mounted from
  `./media` by default) is where organized files get written — point Plex/Jellyfin's
  video library at that same host folder.
- `yt-dlp` and `ffmpeg` are installed into the image at build time — no host setup.
- The container runs as a fixed non-root user (uid/gid 1000). If you bind-mount a host
  directory for `/media` instead of using a named volume, make sure it's writable by
  uid 1000: `sudo chown -R 1000:1000 ./media`.
- **Upgrading an existing deployment** created before the non-root change: the named
  `/config` volume will still be root-owned from the previous root-run container. Fix
  it once with:
  ```bash
  docker compose run --rm --user root vidarr chown -R 1000:1000 /config /media
  ```
  before starting the updated image.
- Get the API key from the container logs:
  ```bash
  docker compose logs vidarr | grep -A2 "Generated a new API key"
  ```

## Local development

For working on vidarr itself (not a deployment target) — see
[`README.md`](../README.md#local-development) for the full setup: `npm install`,
copying `.env.example`, running migrations, and `npm run dev:server` /
`npm run dev:web`.

## Native Linux (systemd)

Runs the built app directly as a system service — no Docker.

### 1. Get the code and install host dependencies

```bash
git clone <your-vidarr-repo-url> /opt/vidarr
cd /opt/vidarr
sudo apt update
sudo apt install -y ffmpeg python3 python3-pip
pip3 install --break-system-packages yt-dlp
```
(`ffprobe` ships with the `ffmpeg` apt package.)

### 2. Create a dedicated non-root user

```bash
sudo useradd -r -m -d /var/lib/vidarr -s /usr/sbin/nologin vidarr
sudo mkdir -p /var/lib/vidarr/config /var/lib/vidarr/media
sudo chown -R vidarr:vidarr /var/lib/vidarr /opt/vidarr
```
`/var/lib/vidarr/media` is where organized files land — point Plex/Jellyfin's video
library at this path.

### 3. Build

```bash
cd /opt/vidarr
sudo -u vidarr npm install
sudo -u vidarr npm run build
```
Runs the root `build` script: `packages/shared-types` → `apps/server` (→
`apps/server/dist/`) → `apps/web` (→ `apps/web/dist/`).

### 4. Environment file

```bash
sudo -u vidarr tee /opt/vidarr/apps/server/.env > /dev/null <<'EOF'
DATABASE_URL=file:/var/lib/vidarr/config/vidarr.db
WEB_DIST_PATH=/opt/vidarr/apps/web/dist
PORT=3434
EOF
```
Add `YTDLP_PATH=`/`FFMPEG_PATH=` here only if they didn't land on `PATH` in step 1.

### 5. Run the migration once

```bash
cd /opt/vidarr/apps/server
sudo -u vidarr npx prisma migrate deploy
```

### 6. systemd unit

`/etc/systemd/system/vidarr.service`:
```ini
[Unit]
Description=vidarr
After=network.target

[Service]
Type=simple
User=vidarr
Group=vidarr
WorkingDirectory=/opt/vidarr/apps/server
EnvironmentFile=/opt/vidarr/apps/server/.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Confirm `/usr/bin/node` is actually where Node lives (`which node`) and adjust if not.

### 7. Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vidarr
sudo systemctl status vidarr
```

### 8. Get the API key and check logs

```bash
sudo journalctl -u vidarr -n 50 --no-pager | grep -A2 "Generated a new API key"
sudo journalctl -u vidarr -f   # follow logs live
```
If it fails to start, `systemctl status vidarr` shows the exit reason first.

### 9. Upgrading later

```bash
sudo systemctl stop vidarr
cd /opt/vidarr && sudo -u vidarr git pull && sudo -u vidarr npm install && sudo -u vidarr npm run build
cd apps/server && sudo -u vidarr npx prisma migrate deploy
sudo systemctl start vidarr
```

## Native Windows (service wrapper)

### 1. Build

```powershell
npm install
npm run build
```

### 2. Set up the environment and database

Create `apps\server\.env` (copy from `.env.example`) with:
```
DATABASE_URL=file:C:\vidarr-data\vidarr.db
WEB_DIST_PATH=C:\vidarr\apps\web\dist
PORT=3434
```
Add `YTDLP_PATH=`/`FFMPEG_PATH=` if those tools aren't on `PATH`.

Then run the migration once:
```powershell
cd apps\server
npx prisma migrate deploy
```

### 3. Run it directly (to confirm it works before wrapping as a service)

```powershell
node apps\server\dist\main.js
```
The API key prints to this console on first boot. Open `http://localhost:3434` and
confirm the app loads before moving to step 4.

### 4. Install as a Windows service

Plain Node has no built-in "install as a service" mechanism, so use a wrapper:

- **[NSSM](https://nssm.cc/)** (Non-Sucking Service Manager) — simplest option:
  ```powershell
  nssm install vidarr "C:\Program Files\nodejs\node.exe" "C:\vidarr\apps\server\dist\main.js"
  ```
  Then set the working directory (`C:\vidarr\apps\server`) and environment variables
  in the NSSM GUI (`nssm edit vidarr`), and start it:
  ```powershell
  nssm start vidarr
  ```
- **[WinSW](https://github.com/winsw/winsw)** — an XML-config service wrapper, same idea.
- **Simplest fallback**: a Scheduled Task set to "run at startup," pointing at a
  `.bat` file that sets the env vars and calls `node dist\main.js`. Less robust than a
  real service (no auto-restart on crash) but requires no extra download.

Downloading and running NSSM/WinSW means fetching an executable from a third-party
site — do that yourself rather than having it done for you, and verify the download
against the project's own release page before running it.

## Security notes (apply to every deployment path)

- Every `/api/v1/*` route requires the API key — there is no unauthenticated access.
- **Don't expose vidarr directly to the internet.** Like Sonarr/Radarr/Lidarr, it's
  designed to be reached over your own network, a VPN, or Tailscale — not
  port-forwarded. It stores plaintext credentials for every indexer, download client,
  and library connector you configure, and has no rate limiting or intrusion
  detection of its own.
- If you do put it behind a reverse proxy, terminate TLS there. vidarr doesn't trust
  `X-Forwarded-*` headers for anything — it only checks the API key header — so
  there's nothing proxy-related to misconfigure into an auth bypass (the class of
  issue Sonarr's own
  [CVE-2026-30975](https://github.com/Sonarr/Sonarr/security/advisories/GHSA-h5qx-5hjf-7c9r)
  was).

See [`README.md`](../README.md) for feature documentation and
[`docs/plan.md`](plan.md) for build history and design rationale.
