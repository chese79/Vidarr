# --- build stage ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/config/ packages/config/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm install

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

COPY package.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/server/package.json apps/server/
RUN npm install --omit=dev --workspace @vidarr/server --workspace @vidarr/shared-types

COPY --from=build /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/prisma apps/server/prisma
COPY --from=build /app/apps/web/dist apps/web/dist

ENV NODE_ENV=production
ENV PORT=3434
ENV DATABASE_URL="file:/config/vidarr.db"
ENV WEB_DIST_PATH=/app/apps/web/dist

# Don't run as root — a fixed uid/gid (1000, a common non-root default) so a
# named Docker volume's ownership is predictable. If you bind-mount ./media
# from the host instead, make sure that host directory is writable by uid
# 1000 (e.g. `chown -R 1000:1000 ./media`), since a bind mount keeps the
# host's ownership rather than the image's.
RUN groupadd -g 1000 vidarr && useradd -u 1000 -g vidarr -M -s /usr/sbin/nologin vidarr \
  && mkdir -p /config /media \
  && chown -R vidarr:vidarr /config /media /app

USER vidarr
WORKDIR /app/apps/server
EXPOSE 3434
VOLUME ["/config", "/media"]

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
