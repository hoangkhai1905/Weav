# syntax=docker/dockerfile:1
# Static admin image. Build context: REPO ROOT.
#   docker build -f apps/admin/Dockerfile --build-arg VITE_API_GATEWAY_URL=https://api.example -t weav-admin .
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/admin/package.json ./apps/admin/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --filter ./apps/admin... --frozen-lockfile

COPY apps/admin ./apps/admin

ARG VITE_API_GATEWAY_URL
ENV VITE_API_GATEWAY_URL=$VITE_API_GATEWAY_URL

# Without it the app silently falls back to http://localhost:3000.
RUN test -n "$VITE_API_GATEWAY_URL" \
    || { echo "ERROR: build arg VITE_API_GATEWAY_URL is required" >&2; exit 1; }
RUN pnpm --filter ./apps/admin build
# The fallback literal stays in the bundle, so prove the configured URL was baked in instead.
RUN grep -rqF "$VITE_API_GATEWAY_URL" apps/admin/dist/assets \
    || { echo "ERROR: configured API URL not found in the bundle" >&2; exit 1; }

FROM nginxinc/nginx-unprivileged:1.28.0-alpine
COPY infrastructure/nginx/spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/admin/dist /usr/share/nginx/html
