FROM node:22-alpine

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable

WORKDIR /app

ARG VITE_API_URL=http://localhost:3100
ENV VITE_API_URL=${VITE_API_URL}

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/downloader-core/package.json packages/downloader-core/package.json

RUN pnpm install --filter ./apps/web... --frozen-lockfile --ignore-scripts

COPY apps/web apps/web
COPY packages/downloader-core packages/downloader-core

EXPOSE 3000

CMD ["pnpm", "--filter", "./apps/web", "exec", "vite", "dev", "--host", "0.0.0.0", "--port", "3000"]
