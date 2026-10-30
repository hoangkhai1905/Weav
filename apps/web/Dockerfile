# syntax=docker/dockerfile:1
# Static web image. Build context: REPO ROOT.
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL=https://api.example --build-arg VITE_IDENTITY_SERVICE_URL=https://api.example -t weav-web .
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --filter ./apps/web... --frozen-lockfile

COPY apps/web ./apps/web

ARG VITE_API_BASE_URL
ARG VITE_IDENTITY_SERVICE_URL
ARG VITE_API_MODE=http
ARG VITE_PUBLIC_WEBHOOK_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_IDENTITY_SERVICE_URL=$VITE_IDENTITY_SERVICE_URL \
    VITE_API_MODE=$VITE_API_MODE \
    VITE_PUBLIC_WEBHOOK_BASE_URL=$VITE_PUBLIC_WEBHOOK_BASE_URL

# Without these the app silently falls back to http://localhost:3000 / :8081.
RUN test -n "$VITE_API_BASE_URL" -a -n "$VITE_IDENTITY_SERVICE_URL" \
    || { echo "ERROR: build args VITE_API_BASE_URL and VITE_IDENTITY_SERVICE_URL are required" >&2; exit 1; }
RUN pnpm --filter ./apps/web build
# The fallback literals stay in the bundle, so prove the configured URLs were baked in instead.
RUN grep -rqF "$VITE_API_BASE_URL" apps/web/dist/assets && grep -rqF "$VITE_IDENTITY_SERVICE_URL" apps/web/dist/assets \
    || { echo "ERROR: configured API URLs not found in the bundle" >&2; exit 1; }

FROM nginxinc/nginx-unprivileged:1.28.0-alpine
COPY infrastructure/nginx/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
