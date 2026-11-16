# The validator image. Build from the repository root:
#   docker build -f packages/validator/Dockerfile -t tcg-gauntlet-validator .

# ---- build stage ----------------------------------------------------------------
FROM node:22-bookworm-slim AS build
# better-sqlite3 compiles from source when no prebuilt binary matches.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
# pnpm reads the version from "packageManager" in package.json (through corepack).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY presets ./presets
COPY template ./template
# Only the validator and what it depends on: no other package is built or installed.
RUN pnpm install --frozen-lockfile --filter "@tcg-gauntlet/validator..."
RUN pnpm --filter "@tcg-gauntlet/validator..." build
# inject-workspace-packages (.npmrc) makes `deploy` copy the built workspace packages
# in, so /out has no links back to /repo.
RUN pnpm --filter @tcg-gauntlet/validator deploy --prod /out

# ---- runtime stage --------------------------------------------------------------
FROM node:22-bookworm-slim
# git: the validator runs `git diff` for --changed-since.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out /app
COPY presets /app/presets
ENV PRESETS_DIR=/app/presets
RUN chmod +x /app/dist/cli.js \
 && ln -s /app/dist/cli.js /usr/local/bin/tcg-gauntlet-validate
USER node
ENTRYPOINT ["tcg-gauntlet-validate"]
