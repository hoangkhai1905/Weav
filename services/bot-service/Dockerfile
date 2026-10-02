# syntax=docker/dockerfile:1
# Production image (X-16). Build context: REPO ROOT.
#   docker build -t weav-bot -f services/bot-service/Dockerfile .
# Dev uses Dockerfile.dev (nest start --watch); this file is not used by compose.dev.yml.
FROM node:24-alpine AS build
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
WORKDIR /workspace

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/bot-service/package.json ./services/bot-service/package.json
COPY packages ./packages
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --filter ./services/bot-service... --frozen-lockfile

COPY services/bot-service ./services/bot-service
RUN pnpm --filter ./services/bot-service build

# Production-only node_modules + built output in /out.
RUN pnpm --filter ./services/bot-service --prod --legacy deploy /out \
    && cp -r services/bot-service/dist /out/dist

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out /app

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000C:/Program Files/Git/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/main.js"]
