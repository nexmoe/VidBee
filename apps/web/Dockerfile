FROM node:22-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/downloader-core/package.json packages/downloader-core/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --filter "{./apps/web}..." --frozen-lockfile --ignore-scripts

COPY apps/web apps/web
COPY packages/downloader-core packages/downloader-core
COPY packages/i18n packages/i18n
COPY packages/ui packages/ui

RUN pnpm --filter ./apps/web run build

FROM node:22-alpine AS runner

ENV NODE_ENV=production
ENV VIDBEE_API_URL_INTERNAL=http://api:3100
ENV VIDBEE_WEB_HOST=0.0.0.0
ENV VIDBEE_WEB_PORT=3000

WORKDIR /app

COPY --from=builder --chown=node:node /app/apps/web/dist ./dist
COPY --from=builder --chown=node:node /app/apps/web/server.mjs ./server.mjs

USER node

EXPOSE 3000

CMD ["node", "server.mjs"]
