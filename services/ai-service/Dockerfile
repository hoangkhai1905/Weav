# syntax=docker/dockerfile:1
# Production image (X-16). Build context: REPO ROOT.
#   docker build -t weav-ai -f services/ai-service/Dockerfile .
# Dev uses Dockerfile.dev (nest start --watch); this file is not used by compose.dev.yml.
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/ai-service/package.json ./services/ai-service/package.json
COPY packages ./packages
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --filter ./services/ai-service... --frozen-lockfile

COPY services/ai-service ./services/ai-service
RUN pnpm --filter ./services/ai-service build

# Production-only node_modules + built output in /out.
RUN pnpm --filter ./services/ai-service --prod --legacy deploy /out \
    && rm -rf /out/dist && cp -r services/ai-service/dist /out/dist

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/main.js"]
