# --- build stage ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/config/ packages/config/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages/shared-types/ packages/shared-types/
COPY apps/server/ apps/server/
COPY apps/web/ apps/web/

RUN npm run build --workspace @vidarr/shared-types
RUN npm run prisma:generate --workspace @vidarr/server
RUN npm run build --workspace @vidarr/server
RUN npm run build --workspace @vidarr/web

# --- runtime stage ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# python3/pip for yt-dlp; xz-utils only to extract the static ffmpeg build
# below (kept installed afterward — trivial size, not worth a separate purge
# layer); curl for yt-dlp's own needs plus this image's HEALTHCHECK.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip curl xz-utils \
  && pip3 install --break-system-packages --no-cache-dir yt-dlp \
  && apt-get purge -y python3-pip \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# Static ffmpeg/ffprobe build instead of Debian's `ffmpeg` package. apt's
# ffmpeg drags in a large tree of hard dependencies vidarr never uses
# (libsdl2, libcairo2, libpango, librsvg2, X11/GLX libraries — all there for
# ffplay's display output and subtitle/font rendering, not headless
# transcode/probe) — installing them was the single largest cost in this
# build (~11 minutes measured). Trade-off: this binary isn't tracked by
# Debian's security team the way an apt package is — `apt-get upgrade` won't
# patch it; bump the pinned build here if a real ffmpeg CVE ever matters for
# this deployment. Checksummed (MD5, the only verification johnvansickle.com
# publishes) against the corresponding .md5 file — that guards against a
# corrupted/truncated download, not a compromised origin.
ARG TARGETARCH
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) FFMPEG_ARCH=amd64 ;; \
      arm64) FFMPEG_ARCH=arm64 ;; \
      *) echo "Unsupported architecture for static ffmpeg: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    cd /tmp; \
    curl -fsSLO "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz"; \
    curl -fsSLO "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz.md5"; \
    md5sum -c "ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz.md5"; \
    mkdir ffmpeg-extract; \
    tar -xJf "ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz" -C ffmpeg-extract --strip-components=1; \
    install -m 0755 ffmpeg-extract/ffmpeg /usr/local/bin/ffmpeg; \
    install -m 0755 ffmpeg-extract/ffprobe /usr/local/bin/ffprobe; \
    rm -rf /tmp/ffmpeg-extract /tmp/ffmpeg-release-*; \
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
RUN npm ci --omit=dev --workspace @vidarr/server --workspace @vidarr/shared-types

# npm ci installs the plain @prisma/client package, but that only ships an
# uninitialized stub (node_modules/.prisma/client/default.js throws "did not
# initialize yet" until `prisma generate` has run against schema.prisma) —
# overwrite it with the real client (including its native query-engine
# binary) already generated in the build stage, rather than regenerating.
COPY --from=build /app/node_modules/.prisma/client node_modules/.prisma/client

COPY --from=build /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/prisma apps/server/prisma
COPY --from=build /app/apps/web/dist apps/web/dist

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
