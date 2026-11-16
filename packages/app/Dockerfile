# The app image. Build from the repository root:
#   docker build -f packages/app/Dockerfile -t tcg-gauntlet .
#
#   docker run -p 3000:3000 -v tcg-data:/data -e DECK_REPO_URL=https://github.com/<owner>/<repo> tcg-gauntlet

# ---- build stage ----------------------------------------------------------------
FROM node:22-bookworm-slim AS build
# better-sqlite3 compiles from source when no prebuilt binary matches.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
# pnpm reads the version from "packageManager" in package.json (through corepack).
# tsconfig.base.json is what every package's tsconfig extends.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY presets ./presets
# Only the app and what it depends on (engine, carddata, repo): no other package is
# built or installed.
RUN pnpm install --frozen-lockfile --filter "@tcg-gauntlet/app..."
RUN pnpm --filter "@tcg-gauntlet/app..." build
# inject-workspace-packages (.npmrc) makes `deploy` copy the built workspace packages
# in, so /out has no links back to /repo. The app's "files" field ("build") puts the
# SvelteKit output in /out, and the production install builds better-sqlite3 there.
RUN pnpm --filter @tcg-gauntlet/app deploy --prod /out

# ---- runtime stage --------------------------------------------------------------
FROM node:22-bookworm-slim
# git: the sync loop clones and fetches the deck repo.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out /app
COPY presets /app/presets
# Every write goes to /data (the node user owns it).
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    PRESETS_DIR=/app/presets \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node", "/app/build/index.js"]
