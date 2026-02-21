FROM node:22-alpine

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/downloader-core/package.json packages/downloader-core/package.json

RUN pnpm install --filter ./apps/api... --frozen-lockfile --ignore-scripts

COPY apps/api apps/api
COPY packages/downloader-core packages/downloader-core

EXPOSE 3100

ENV VIDBEE_API_HOST=0.0.0.0
ENV VIDBEE_API_PORT=3100
ENV VIDBEE_DOWNLOAD_DIR=/data/downloads

VOLUME ["/data/downloads"]

CMD ["pnpm", "--filter", "./apps/api", "run", "start"]
