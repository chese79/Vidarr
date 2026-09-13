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

# ffmpeg (remux/transcode support) + python3/pip for yt-dlp
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip curl \
  && pip3 install --break-system-packages --no-cache-dir yt-dlp \
  && apt-get purge -y python3-pip \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

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
