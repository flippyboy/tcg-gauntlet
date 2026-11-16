# TCG Gauntlet

TCG Gauntlet runs a deck-building gauntlet for Magic: The Gathering from a plain git repository. Players push deck files, the rules are checked automatically, and a small web app shows the decks, their history and the differences between versions.

> Status: early scaffolding. Nothing below is released yet; see `docs/designs/tcg-gauntlet.md` for the design.

## What is in this repository

1. **The validator.** A CLI and Docker image (`ghcr.io/flippyboy/tcg-gauntlet-validator`) that checks decks against a format.
2. **The GitHub Action.** A composite Action (`actions/validate`) that caches card data and runs the validator image.
3. **The app.** A SvelteKit server (`ghcr.io/flippyboy/tcg-gauntlet`) that you host to browse decks, history and diffs.

## Host it

The images are not published yet. When they are, this starts the app:

```sh
docker run -d --name tcg-gauntlet -p 3000:3000 \
  -v tcg-gauntlet-data:/data \
  -e DECK_REPO_URL=https://github.com/<owner>/<repo> \
  ghcr.io/flippyboy/tcg-gauntlet:v1
# open http://localhost:3000
```

The app clones the repo itself, and checks it for new commits every 30 seconds. A push webhook to `/webhook/github` makes it update at once. An example for [Docker Compose](deploy/compose.yaml) and a [Helm chart](deploy/helm/tcg-gauntlet) for Kubernetes are in `deploy/`. [docs/hosting.md](docs/hosting.md) has every setting.

## Start a new deck repo

In an empty git repository:

```sh
docker run --rm -v "$PWD:/w" -w /w ghcr.io/flippyboy/tcg-gauntlet-validator:v1 init
```

Then edit `gauntlet.yaml`, add decks and push.

## More

- [Hosting the app](docs/hosting.md): settings, volume size, webhook, reverse proxy, operations.
- [Deck repo guide](docs/deck-repo-guide.md): layout, the validator, CI and branch protection.
- [Writing a format](docs/format-authoring.md): `formats/*.yaml`, format keys, why sets and not dates.
- [Architecture](docs/architecture.md): how the code fits together, for contributors.
- [Specifications](spec/README.md): deck files, `gauntlet.yaml`, formats and error codes.
- [Presets](presets/README.md): the formats that ship with the tool.
- [Design and implementation plan](docs/designs/tcg-gauntlet.md).

## Development

Requires Node 22 (see `.node-version`) and pnpm (version pinned in `package.json`).

```sh
pnpm install
pnpm lint && pnpm format && pnpm typecheck && pnpm build && pnpm test
```

## License

MIT. See `LICENSE`.
