# Hosting the app

This guide is for the person who runs the TCG Gauntlet web app. One instance shows one deck repo. The repo must be public: the app clones it over HTTPS with no credentials.

The app is one container with one volume. It needs outbound HTTPS access to `github.com`, `mtgjson.com` and `cards.scryfall.io` (the last one only for the proxy PDF). It does not need a database server.

For the parts of the app that this guide mentions, see [architecture.md](architecture.md).

## Requirements

| Item   | Need                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| Memory | 256 MiB requested, 768 MiB as a limit in the Helm chart.               |
| Disk   | 5 GiB volume. See [Volume size](#volume-size).                                 |
| Image  | `ghcr.io/flippyboy/tcg-gauntlet`, as `v1` (latest 1.x) or an exact tag.        |
| User   | The image runs as the user `node` (uid 1000, gid 1000). It does not run as root. |
| Port   | The app listens on `PORT` (default `3000`) on all interfaces.                  |

## Quick start with Docker

```sh
docker run -d --name tcg-gauntlet \
  -p 3000:3000 \
  -v tcg-gauntlet-data:/data \
  -e DECK_REPO_URL=https://github.com/<owner>/<repo> \
  ghcr.io/flippyboy/tcg-gauntlet:v1
```

Then open `http://localhost:3000`. The page shows "Preparing data" until the first sync is done (see [Cold start](#cold-start)).

The app clones the repo itself into `/data/repo`. Do not mount a repo into the container.

## Deployment

| Source                                               | Use                                                     |
| ---------------------------------------------------- | ------------------------------------------------------- |
| [deploy/compose.yaml](../deploy/compose.yaml)        | Docker Compose, one service and one named volume.       |
| [deploy/helm/tcg-gauntlet/](../deploy/helm/tcg-gauntlet) | Helm chart for Kubernetes. Released as an OCI artifact. |

### Docker Compose

Set `DECK_REPO_URL` in the environment or in `deploy/.env` (Compose reads `.env` from the folder of the compose file), then start it:

```sh
DECK_REPO_URL=https://github.com/<owner>/<repo> docker compose -f deploy/compose.yaml up -d
```

### Kubernetes

The Helm chart is published as an OCI artifact at `oci://ghcr.io/flippyboy/charts/tcg-gauntlet`. Its version is the release version without the leading `v`, for example `1.4.2` for the tag `v1.4.2`. The chart's default image is the matching tag, `ghcr.io/flippyboy/tcg-gauntlet:v1.4.2`. Helm 3.8 or later is needed.

```sh
helm install tcg-gauntlet oci://ghcr.io/flippyboy/charts/tcg-gauntlet \
  --version <x.y.z> \
  --namespace tcg-gauntlet --create-namespace \
  --set deckRepo.url=https://github.com/<owner>/<deck-repo> \
  --set webhook.secret="$(openssl rand -hex 32)"
```

`deckRepo.url` is required, and the install fails without it. `webhook.secret` is optional. Without it the webhook is off and the app polls. To keep the secret out of the Helm release values, create a Secret and name it instead:

```sh
kubectl create secret generic gauntlet-webhook -n tcg-gauntlet \
  --from-literal=webhook-secret="$(openssl rand -hex 32)"
helm upgrade --install ... --set webhook.existingSecret=gauntlet-webhook
```

`webhook.existingSecretKey` names the key in that Secret (default `webhook-secret`). Use the same value as the "Secret" of the GitHub webhook.

Common values:

| Value                       | Use                                                                            |
| --------------------------- | ------------------------------------------------------------------------------ |
| `deckRepo.url`, `deckRepo.branch` | `DECK_REPO_URL` and `DECK_REPO_BRANCH`.                                  |
| `publicBaseUrl`             | `PUBLIC_BASE_URL`.                                                             |
| `extraEnv`                  | Any other environment variable, as a list of `name` and `value` entries.       |
| `persistence.size`, `persistence.storageClass`, `persistence.existingClaim` | The data volume. `persistence.enabled=false` uses an `emptyDir`, and the data is lost when the pod is replaced. |
| `ingress.enabled`, `ingress.className`, `ingress.hosts`, `ingress.tls` | An optional Ingress. It is off by default. |
| `resources`                 | Defaults to a 256 MiB request and a 768 MiB limit.                             |

`helm show values oci://ghcr.io/flippyboy/charts/tcg-gauntlet --version <x.y.z>` prints all values with comments. They are also listed in the [chart README](../deploy/helm/tcg-gauntlet/README.md).

For an ingress, enable it and set the proxy variables from [Behind a reverse proxy](#behind-a-reverse-proxy) through `extraEnv`:

```sh
helm upgrade --install tcg-gauntlet oci://ghcr.io/flippyboy/charts/tcg-gauntlet --version <x.y.z> -n tcg-gauntlet \
  --reuse-values \
  --set ingress.enabled=true --set ingress.className=nginx \
  --set 'ingress.hosts[0].host=gauntlet.example.com' \
  --set 'ingress.hosts[0].paths[0].path=/' \
  --set 'ingress.tls[0].secretName=gauntlet-tls' \
  --set 'ingress.tls[0].hosts[0]=gauntlet.example.com' \
  --set publicBaseUrl=https://gauntlet.example.com \
  --set 'extraEnv[0].name=ORIGIN' --set 'extraEnv[0].value=https://gauntlet.example.com' \
  --set 'extraEnv[1].name=ADDRESS_HEADER' --set 'extraEnv[1].value=X-Forwarded-For' \
  --set-string 'extraEnv[2].name=XFF_DEPTH' --set-string 'extraEnv[2].value=1'
```

With many values, put them in a file and pass it with `-f values.yaml`.

The Deployment has one replica and the `Recreate` strategy, and the chart has no replica setting. The app keeps its state on a volume that one pod can use, and it runs one sync loop, so do not scale it above one replica. The pod runs as uid and gid 1000, which are the ids of the `node` user in the image, and `fsGroup: 1000` makes the volume writable for it.

The container has a read-only root filesystem. The app writes to `/data`. The `emptyDir` at `/tmp` is for the temporary files that SQLite creates while it builds the format tables. The app does not write anywhere else: git's home folder is `/data/home`, and the card-data download goes to `/data/tmp`.

The Service is `ClusterIP` on port 3000. The chart creates a ServiceAccount that does not mount an API token. After the install, `helm status tcg-gauntlet -n tcg-gauntlet` prints how to reach the app and the webhook URL. The app clones only public repos, so the chart has no setting for repo credentials.

## Environment variables

The app reads these variables. A variable that is set to an empty string counts as not set. An invalid value stops the app at startup with a message that names the variable.

| Variable                | Default                      | Meaning                                                                                                                                                      |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DECK_REPO_URL`         | none, required               | `https://github.com/<owner>/<repo>`, optionally ending in `.git` or `/`. No user info, query or extra path. The app stores it in lower case without `.git`.  |
| `DECK_REPO_BRANCH`      | `main`                       | The branch to track. Letters, digits, `.`, `_`, `/` and `-` only. It must not start with `-` or contain `..`.                                                |
| `DATA_DIR`              | `/data`                      | The volume. It holds the clone, card data, derived files, history and the image cache.                                                                       |
| `PORT`                  | `3000`                       | The HTTP port, 1 to 65535.                                                                                                                                   |
| `PUBLIC_BASE_URL`       | none                         | The public address of the site, `http(s)://...`. `/status` uses it to show the webhook URL. A trailing `/` is removed.                                       |
| `POLL_INTERVAL_SECONDS` | `30`                         | How often the app asks GitHub for the branch's latest commit, 10 to 3600. Each wait is varied by up to 10% either way.                                       |
| `WEBHOOK_SECRET`        | none                         | Turns on `/webhook/github`. Without it that route answers 404.                                                                                               |
| `MTGJSON_BASE_URL`      | `https://mtgjson.com/api/v5` | Where MTGJSON is downloaded from. `http(s)://...`.                                                                                                           |
| `MTGJSON_REFRESH_HOURS` | `24`                         | How often the app checks `Meta.json` for a new MTGJSON version, 1 to 168.                                                                                    |
| `IMAGE_CACHE_MAX_MB`    | `500`                        | Size cap of the card-image cache for the proxy PDF, 50 to 100000.                                                                                            |
| `HISTORY_MAX_VERSIONS`  | `100`                        | The most versions that a deck's history page lists, 1 to 10000.                                                                                              |
| `LOG_LEVEL`             | `info`                       | `debug`, `info`, `warn` or `error`. Logs are one JSON object per line on standard output.                                                                    |
| `PRESETS_DIR`           | `/app/presets`               | Where the bundled presets are read from. The image already contains them.                                                                                    |

The Docker image sets `NODE_ENV=production`, `PRESETS_DIR=/app/presets`, `DATA_DIR=/data` and `PORT=3000`.

### Variables of the Node adapter

The app is built with SvelteKit's `adapter-node`, which reads these variables itself. They are not validated by the app.

| Variable           | Default  | Meaning                                                                                                               |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `ADDRESS_HEADER`   | none     | The request header that holds the client address, for example `X-Forwarded-For`. See the next section.               |
| `XFF_DEPTH`        | `1`      | How many proxies sit in front of the app. Used with `X-Forwarded-For`.                                                |
| `ORIGIN`           | none     | The public origin, for example `https://gauntlet.example.com`.                                                        |
| `PROTOCOL_HEADER`  | none     | The header that holds the original protocol, for example `X-Forwarded-Proto`. Use it instead of `ORIGIN`.             |
| `HOST_HEADER`      | none     | The header that holds the original host, for example `X-Forwarded-Host`. Use it instead of `ORIGIN`.                  |
| `HOST`             | `0.0.0.0` | The address to listen on.                                                                                            |
| `SHUTDOWN_TIMEOUT` | `30`     | Seconds the server waits for open requests when it stops.                                                             |
| `BODY_SIZE_LIMIT`  | `512K`   | The largest request body. See [The GitHub webhook](#the-github-webhook).                                              |

`ALLOW_INSECURE_TEST_REPO_URL`, `TCG_GAUNTLET_MIN_CARDS` and `TCG_GAUNTLET_IMAGE_UPSTREAM` exist for the test suite. Do not set them in production.

## Volume size

Plan for 5 GiB. These are the parts of `/data`:

| Path                          | Size                                                         | Note                                                                                      |
| ----------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `mtgjson/<version>-<date>/`   | about 0.72 GB for each version                               | The unpacked `AllPrintings.sqlite`. The app keeps the current and the previous version.   |
| `tmp/`                        | up to about 0.95 GB during a refresh                         | The download (0.23 GB) and the unpacked file. It is removed when the refresh ends.         |
| `derived/`                    | about 12 MB for each version                                 | Format tables, built from the MTGJSON file.                                               |
| `repo/`                       | the size of the deck repo's clone                            | A full clone, because the history needs every commit.                                     |
| `history.sqlite`              | under 1 MB for 100 decks and 3,000 commits                   | From [spike 4](spikes/git-history-cost.md).                                               |
| `images/`                     | at most `IMAGE_CACHE_MAX_MB`                                 | Card images that the proxy PDF used.                                                      |
| `home/`                       | a few KB                                                     | The home folder of git.                                                                   |

The peak is the two kept versions (1.44 GB), a refresh in progress (0.95 GB), the image cache (0.5 GB by default) and the clone. That is about 3 GB plus the clone. The numbers for MTGJSON come from [spike 1](spikes/mtgjson-size.md), measured on 2026-11-15.

`/status` shows `disk_free_bytes`, the free space of the volume.

## Cold start

A cold start is the first start with an empty volume. It needs no manual steps.

1. The process starts. `/healthz` answers at once. `/readyz` answers 503 and the pages answer 503 "Preparing data".
2. The app clones the repo and downloads MTGJSON at the same time. The download is `AllPrintings.sqlite.gz`, 227 MB. The app unpacks it, checks its SHA-256 against the one MTGJSON publishes, and runs a self-check on the tables.
3. The app builds the format tables for the formats that the repo uses, then builds the history.
4. The app builds the first snapshot. `/readyz` answers 200.

Timing, from [spike 1](spikes/mtgjson-size.md) and [spike 4](spikes/git-history-cost.md):

| Step                                                                   | Measured on a developer machine (4 cores, home internet) | Estimate for a 4 vCPU host (not measured) |
| ---------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| Download 227 MB                                                        | 3.9 s                                                    | 5 to 20 s                                 |
| Unpack                                                                 | 2.9 s                                                    | 3 to 6 s                                  |
| SHA-256 of both files                                                  | 1.7 s                                                    | 2 to 3 s                                  |
| Build format tables                                                    | 1.3 s                                                    | 2 to 4 s                                  |
| History for 100 decks and 3,000 commits                                | 0.25 s                                                   | under 1 s                                 |
| Total                                                                  | about 12 s                                               | about 15 to 40 s                          |

The time grows with a slow network link, because the download is the largest part. A restart with a filled volume does not download anything. It checks the SHA-256 of the current MTGJSON file again, which takes about 1.3 s, and then runs one sync.

If the first sync fails, for example because GitHub is not reachable, the app has no snapshot and keeps answering 503. It retries with a growing wait (see [Operations](#operations)).

## The GitHub webhook

Without a webhook the app finds a new commit within one poll interval, 30 seconds by default. A webhook makes it start a sync at once. Both can run together.

1. Set `WEBHOOK_SECRET` on the app to a long random string, for example the output of `openssl rand -hex 32`.
2. In the deck repo on GitHub, open **Settings**, then **Webhooks**, then **Add webhook**.
3. Set **Payload URL** to `https://<your host>/webhook/github`.
4. Set **Content type** to `application/json`. The app reads the body as JSON. A form-encoded body is ignored.
5. Set **Secret** to the same string as `WEBHOOK_SECRET`.
6. Under **Which events would you like to trigger this webhook?**, choose **Just the push event**.
7. Keep **Active** on, and save.

How the app answers a delivery:

| Answer | When                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------- |
| 404    | `WEBHOOK_SECRET` is not set.                                                                                          |
| 401    | The `X-Hub-Signature-256` header is missing or wrong. The check is HMAC-SHA256 over the raw body.                     |
| 202    | The delivery was accepted. This also covers a `ping`, any event other than `push`, and a push to another branch.      |
| 429    | A sync was triggered less than 5 seconds ago. The app polls anyway, so nothing is lost.                               |
| 503    | The app has not built its first snapshot yet.                                                                         |
| 413    | The body is larger than `BODY_SIZE_LIMIT` (512 KB). Raise the limit, or let polling pick the change up.               |

The app reads only the event name and the `ref` of the payload. A delivery can start a sync and nothing else. If `PUBLIC_BASE_URL` is set, `/status` shows the webhook URL in `webhook_url`.

## Behind a reverse proxy

The image route `/img/...` allows 120 requests per minute for each client address. The app gets that address from the connection. Behind a reverse proxy, every request then comes from the proxy, and all users share one limit.

To fix that, make the proxy send the client address in a header, and tell the app which header to read:

| Setting          | Value                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ADDRESS_HEADER` | `X-Forwarded-For`, or another header that your proxy sets.                                                       |
| `XFF_DEPTH`      | The number of proxies in front of the app. With `X-Forwarded-For`, the app counts that many entries from the right. The default is 1. |

Rules for these settings:

- Set `ADDRESS_HEADER` only when a proxy always sets the header. Clients can send their own header. If the proxy does not overwrite or append to it, a client can pick its own address and avoid the limit.
- If `ADDRESS_HEADER` is set and a request arrives without that header, the adapter fails the request that needs the address, which is `/img`.
- With `XFF_DEPTH` too high, the app reads an address that the client controls. With it too low, the app reads the address of one of your own proxies.

If the proxy ends TLS, the app sees `http://`. SvelteKit rejects form posts and some requests when the origin does not match. Set one of these:

- `ORIGIN=https://gauntlet.example.com`, or
- `PROTOCOL_HEADER=X-Forwarded-Proto` and `HOST_HEADER=X-Forwarded-Host`.

Set `PUBLIC_BASE_URL` to the same public address. The proxy must pass the `Host` header or `X-Forwarded-Host` through, and must let `POST /webhook/github` reach the app.

Example for an nginx proxy that terminates TLS:

```text
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

```sh
docker run -d -p 127.0.0.1:3000:3000 -v tcg-gauntlet-data:/data \
  -e DECK_REPO_URL=https://github.com/<owner>/<repo> \
  -e PUBLIC_BASE_URL=https://gauntlet.example.com \
  -e ORIGIN=https://gauntlet.example.com \
  -e ADDRESS_HEADER=X-Forwarded-For \
  -e XFF_DEPTH=1 \
  ghcr.io/flippyboy/tcg-gauntlet:v1
```

`proxy_set_header X-Forwarded-For $remote_addr` replaces any value that the client sent, which is what `XFF_DEPTH=1` needs.

## Operations

### Health endpoints

| Path       | Answer                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/healthz` | 200 `ok` while the process runs. Use it for liveness. The image's `HEALTHCHECK` calls it.                                    |
| `/readyz`  | 200 `ready` when a snapshot and the card data exist, otherwise 503 `not ready`. A snapshot stays in use while later syncs fail, so the answer stays 200. |
| `/status`  | JSON, described below.                                                                                                       |

### Reading `/status`

```sh
curl -s http://localhost:3000/status
```

| Field                  | Meaning                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `engineVersion`        | The version of the rules engine.                                                                                 |
| `ready`                | The same as `/readyz`.                                                                                           |
| `lastSync.commit`      | The commit that the pages show. `null` before the first sync.                                                    |
| `lastSync.started`, `lastSync.finished`, `lastSync.durationMs` | When the last sync ran and how long it took.                         |
| `lastSync.error`       | The error of the last sync, or `null` when it worked.                                                            |
| `consecutive_failures` | Failed syncs in a row since the last success.                                                                    |
| `stale_since`          | The time of the first failure since the last success, or `null`.                                                 |
| `card_data.version`, `card_data.date`, `card_data.sha256` | The MTGJSON version in use.                                                    |
| `card_data.last_check` | When the app last asked MTGJSON for a new version.                                                               |
| `card_data.error`      | The error of the last refresh, or `null`. A failed refresh leaves the current version in use.                    |
| `formats`              | The format keys that the app built tables for.                                                                   |
| `history`              | `building` or `ready`.                                                                                           |
| `disk_free_bytes`      | Free space on the volume, or `null` when it cannot be read.                                                      |
| `webhook_url`          | `PUBLIC_BASE_URL` plus `/webhook/github`, or `null` when the webhook is off or `PUBLIC_BASE_URL` is not set.     |

The field names are partly camel case and partly snake case. They are written here as the app returns them.

What to look for:

- `lastSync.error` is not `null` and `consecutive_failures` grows: the sync fails. The app keeps the last good snapshot. After 3 failures in a row every page shows "Content may be out of date since <time>". Read the logs for the cause.
- After a failure the app waits 30 seconds before the next try, then 60, 120 and so on up to 10 minutes. The first success resets the wait.
- `card_data.error` is not `null`: the MTGJSON refresh failed. The app keeps working on the version it has. `/status` shows when it last checked.

### Logs

The app writes one JSON object per line to standard output. A sync writes `sync done`, `history updated` and `sync failed` lines. Set `LOG_LEVEL=debug` for more.

### Upgrading and rolling back

Images are tagged `vMAJOR.MINOR.PATCH`, `vMAJOR.MINOR` and `vMAJOR`. `latest` points at the newest release that is not a pre-release.

- To follow minor and patch releases, use `:v1`. Pull the new image and restart the container.
- To control the version, use an exact tag such as `:v1.4.2`. To upgrade or roll back, change the tag and restart.
- On Kubernetes, the chart version selects the image. Upgrade with `helm upgrade --version <x.y.z>`, or set `image.tag` (for example `v1`) to follow a floating tag.

```sh
# Docker
docker pull ghcr.io/flippyboy/tcg-gauntlet:v1
docker rm -f tcg-gauntlet
# then run the same docker run command again; the volume keeps the data

# Docker Compose
docker compose -f deploy/compose.yaml pull
docker compose -f deploy/compose.yaml up -d

# Kubernetes
helm upgrade tcg-gauntlet oci://ghcr.io/flippyboy/charts/tcg-gauntlet --version <x.y.z> -n tcg-gauntlet --reuse-values
helm rollback tcg-gauntlet -n tcg-gauntlet
```

The volume survives a restart, so the new container starts from the stored clone and card data, and runs one sync. A new release can build format tables or history again when it needs to, and `/status` shows `history: building` while it does.

A new major version can change schemas or error codes. Read its release notes before you upgrade across a major version. A rollback to an older image uses the same volume. If the old image cannot use the files that the new one wrote, stop the container, delete the volume and start again. The volume holds only copies of the deck repo and of MTGJSON, so nothing is lost.

### Backups

There is nothing to back up. The deck repo holds the decks and MTGJSON holds the card data. Both are downloaded again on a cold start. Old MTGJSON versions are not available, so a rebuilt volume uses the current MTGJSON version. The verdicts of official formats can differ between MTGJSON versions. Verdicts of preset and repo formats do not.

### Stopping

On `SIGTERM` the app stops its timers and waits up to 25 seconds for a running sync. Give the container a grace period longer than that. The examples use 45 seconds.
