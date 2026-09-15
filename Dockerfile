# --- base stage: deps + shared-types + prisma client (feeds both parallel builds below) ---
FROM node:20-bookworm-slim AS base
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/config/ packages/config/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci

COPY packages/shared-types/ packages/shared-types/
COPY apps/server/ apps/server/
COPY apps/web/ apps/web/

RUN npm run build --workspace @vidarr/shared-types
RUN npm run prisma:generate --workspace @vidarr/server

# --- server build (BuildKit runs this concurrently with build-web below —
# both only depend on `base`, not on each other) ---
FROM base AS build-server
RUN npm run build --workspace @vidarr/server

# --- web build (concurrent with build-server) ---
FROM base AS build-web
RUN npm run build --workspace @vidarr/web

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# python3/pip for yt-dlp; xz-utils only to extract the static ffmpeg build
# below (kept installed afterward — trivial size, not worth a separate purge
# layer); curl for yt-dlp's own needs plus this image's HEALTHCHECK.
# Cache mounts on apt's package index + archive dirs: these aren't part of
# the final image layer either way, so caching them costs nothing and lets a
# rebuild skip re-fetching Debian's package index and re-downloading .debs —
# `apt-get update`'s network fetch was the single largest piece of this
# layer's time (~335s measured) even after ffmpeg itself was removed from it.
RUN --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    --mount=type=cache,target=/var/cache/apt,sharing=locked \
    apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip curl xz-utils \
  && pip3 install --break-system-packages --no-cache-dir yt-dlp \
  && apt-get purge -y python3-pip \
  && apt-get autoremove -y

# Static ffmpeg/ffprobe build instead of Debian's `ffmpeg` package. apt's
# ffmpeg drags in a large tree of hard dependencies vidarr never uses
# (libsdl2, libcairo2, libpango, librsvg2, X11/GLX libraries — all there for
# ffplay's display output and subtitle/font rendering, not headless
# transcode/probe) — installing them was the single largest cost in this
# build (~11 minutes measured), and cuts the final image by ~300MB regardless
# of network conditions. Trade-off: this binary isn't tracked by Debian's
# security team the way an apt package is — `apt-get upgrade` won't patch it;
# bump the pinned build here if a real ffmpeg CVE ever matters for this
# deployment. Checksummed (MD5, the only verification johnvansickle.com
# publishes) against the corresponding .md5 file — that guards against a
# corrupted/truncated download, not a compromised origin. The download
# itself is cache-mounted (skip re-fetching ~80MB on every rebuild when nothing
# changed) — re-verified against its checksum on every build regardless of
# whether it came from cache or a fresh download.
#
# curl is bounded (--max-time per attempt, a few retries) rather than
# unbounded — measured directly against johnvansickle.com from this network:
# one build finished this download in 379s, another took 1202s for the same
# ~80MB file. Better to fail loudly and retryably within a known ceiling
# (worst case ~3 attempts x 180s + delays, well under 10 minutes) than risk
# a silent 20-minute stall with no feedback.
ARG TARGETARCH
RUN --mount=type=cache,target=/var/cache/ffmpeg-dl set -eu; \
    case "${TARGETARCH}" in \
      amd64) FFMPEG_ARCH=amd64 ;; \
      arm64) FFMPEG_ARCH=arm64 ;; \
      *) echo "Unsupported architecture for static ffmpeg: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    cd /var/cache/ffmpeg-dl; \
    if [ ! -f "ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz" ] \
       || ! md5sum -c "ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz.md5" >/dev/null 2>&1; then \
      curl -fSL --connect-timeout 15 --max-time 180 --retry 2 --retry-delay 5 --retry-all-errors \
        -O "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz"; \
      curl -fSL --connect-timeout 15 --max-time 60 --retry 2 --retry-delay 5 --retry-all-errors \
        -O "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz.md5"; \
      md5sum -c "ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz.md5"; \
    fi; \
    mkdir -p /tmp/ffmpeg-extract; \
    tar -xJf "ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz" -C /tmp/ffmpeg-extract --strip-components=1; \
    install -m 0755 /tmp/ffmpeg-extract/ffmpeg /usr/local/bin/ffmpeg; \
    install -m 0755 /tmp/ffmpeg-extract/ffprobe /usr/local/bin/ffprobe; \
    rm -rf /tmp/ffmpeg-extract; \
    ffmpeg -version | head -1; \
    ffprobe -version | head -1

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/server/package.json apps/server/
# apps/web/package.json is copied (but never its source or dist) purely so
# `npm ci` sees the same full workspace tree the lockfile describes — it's
# strict about that even though --workspace below means web's own deps are
# never actually installed.
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace @vidarr/server --workspace @vidarr/shared-types

# npm ci installs the plain @prisma/client package, but that only ships an
# uninitialized stub (node_modules/.prisma/client/default.js throws "did not
# initialize yet" until `prisma generate` has run against schema.prisma) —
# overwrite it with the real client (including its native query-engine
# binary) already generated in the base stage, rather than regenerating.
COPY --from=base /app/node_modules/.prisma/client node_modules/.prisma/client

COPY --from=base /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=build-server /app/apps/server/dist apps/server/dist
COPY --from=base /app/apps/server/prisma apps/server/prisma
COPY --from=build-web /app/apps/web/dist apps/web/dist

ENV NODE_ENV=production
ENV PORT=3434
ENV DATABASE_URL="file:/config/vidarr.db"
ENV WEB_DIST_PATH=/app/apps/web/dist

# Don't run as root — reuse the "node" user/group (uid/gid 1000) that the
# node:*-bookworm-slim base image already creates, rather than creating a new
# "vidarr" one at the same uid/gid (that groupadd would fail: 1000 is already
# taken by "node" — see Dockerfile-slim.template in nodejs/docker-node). If
# you bind-mount ./media from the host instead of the named volume, make sure
# that host directory is writable by uid 1000 (e.g. `chown -R 1000:1000
# ./media`), since a bind mount keeps the host's ownership rather than the
# image's.
RUN mkdir -p /config /media && chown -R node:node /config /media /app

USER node
WORKDIR /app/apps/server
EXPOSE 3434
VOLUME ["/config", "/media"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3434/api/v1/health || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
