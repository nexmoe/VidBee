FROM node:22-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN apk add --no-cache python3 make g++

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
ENV HUSKY=0

RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/downloader-core/package.json packages/downloader-core/package.json
COPY packages/task-queue/package.json packages/task-queue/package.json
COPY packages/subscriptions-core/package.json packages/subscriptions-core/package.json

RUN pnpm install --filter "{./apps/api}..." --frozen-lockfile

COPY apps/api apps/api
COPY packages/db packages/db
COPY packages/downloader-core packages/downloader-core
COPY packages/task-queue packages/task-queue
COPY packages/subscriptions-core packages/subscriptions-core

RUN pnpm --filter ./apps/api run build
RUN pnpm --filter ./apps/api deploy --prod --legacy /prod/api

FROM node:22-alpine AS runner

ENV YTDLP_PATH=/usr/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV VIDBEE_API_HOST=0.0.0.0
ENV VIDBEE_API_PORT=3100
ENV VIDBEE_DOWNLOAD_DIR=/data/downloads
ENV VIDBEE_MIGRATIONS_DIR=/app/resources/drizzle
ENV VIDBEE_PERSIST_QUEUE=1

RUN apk add --no-cache yt-dlp ffmpeg

WORKDIR /app

COPY --from=builder --chown=node:node /prod/api/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/api/dist ./dist
COPY --chown=node:node apps/desktop/resources/drizzle ./resources/drizzle

RUN mkdir -p /data/downloads && chown -R node:node /data/downloads

USER node

EXPOSE 3100
VOLUME ["/data/downloads"]

CMD ["sh", "-c", "node dist/migrate-history.js && exec node dist/index.js"]
