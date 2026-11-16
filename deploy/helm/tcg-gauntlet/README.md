# tcg-gauntlet Helm chart

Runs the TCG Gauntlet app: one Deployment (one replica, `Recreate` strategy), a Service, a PersistentVolumeClaim, and optionally a Secret and an Ingress. The chart is published as an OCI artifact at `oci://ghcr.io/flippyboy/charts/tcg-gauntlet`. The chart version and the app version are the same as the release tag without the leading `v`.

## Install

```sh
helm install tcg-gauntlet oci://ghcr.io/flippyboy/charts/tcg-gauntlet \
  --version <x.y.z> \
  --namespace tcg-gauntlet --create-namespace \
  --set deckRepo.url=https://github.com/<owner>/<deck-repo>
```

`deckRepo.url` is required. The deck repo must be public. Helm prints the next steps, including the webhook URL.

Upgrade and roll back:

```sh
helm upgrade tcg-gauntlet oci://ghcr.io/flippyboy/charts/tcg-gauntlet --version <x.y.z> -n tcg-gauntlet --reuse-values
helm rollback tcg-gauntlet -n tcg-gauntlet
```

## Values

| Value                                     | Default                          | Description                                                                                                |
| ----------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `image.repository`                        | `ghcr.io/flippyboy/tcg-gauntlet` | Image repository.                                                                                          |
| `image.tag`                               | `""`                             | Image tag. Empty means `v` followed by the chart's `appVersion`.                                           |
| `image.pullPolicy`                        | `IfNotPresent`                   | Image pull policy.                                                                                         |
| `imagePullSecrets`                        | `[]`                             | Pull secrets for the pod.                                                                                  |
| `nameOverride`, `fullnameOverride`        | `""`                             | Override the chart name or the resource names.                                                             |
| `deckRepo.url`                            | none, required                   | `https://github.com/<owner>/<repo>`. Sets `DECK_REPO_URL`.                                                 |
| `deckRepo.branch`                         | `main`                           | Sets `DECK_REPO_BRANCH`.                                                                                   |
| `publicBaseUrl`                           | `""`                             | Sets `PUBLIC_BASE_URL`, the address used for the webhook URL on `/status`.                                 |
| `webhook.secret`                          | `""`                             | Creates a Secret and sets `WEBHOOK_SECRET` from it. Empty means no Secret.                                 |
| `webhook.existingSecret`                  | `""`                             | Name of a Secret you created. Takes priority over `webhook.secret`.                                        |
| `webhook.existingSecretKey`               | `webhook-secret`                 | Key in `webhook.existingSecret`.                                                                           |
| `extraEnv`                                | `[]`                             | More environment entries, such as `ADDRESS_HEADER`, `XFF_DEPTH`, `ORIGIN`, `LOG_LEVEL`. See `values.yaml`. |
| `service.type`                            | `ClusterIP`                      | Service type.                                                                                              |
| `service.port`                            | `3000`                           | Service port.                                                                                              |
| `service.annotations`                     | `{}`                             | Service annotations.                                                                                       |
| `ingress.enabled`                         | `false`                          | Create an Ingress.                                                                                         |
| `ingress.className`                       | `""`                             | `ingressClassName`.                                                                                        |
| `ingress.annotations`                     | `{}`                             | Ingress annotations.                                                                                       |
| `ingress.hosts`                           | one example host                 | List of `host` with `paths` (`path`, `pathType`).                                                          |
| `ingress.tls`                             | `[]`                             | Standard Ingress `tls` entries.                                                                            |
| `persistence.enabled`                     | `true`                           | Use a PVC for `/data`. When false, `/data` is an `emptyDir` and data is lost when the pod is replaced.     |
| `persistence.existingClaim`               | `""`                             | Use this claim and do not create one.                                                                      |
| `persistence.size`                        | `5Gi`                            | Size of the created claim.                                                                                 |
| `persistence.storageClass`                | `""`                             | Storage class. Empty uses the cluster default, `-` sets it to `""`.                                        |
| `persistence.accessModes`                 | `[ReadWriteOnce]`                | Access modes of the created claim.                                                                         |
| `persistence.annotations`                 | `{}`                             | Claim annotations.                                                                                         |
| `resources`                               | 256Mi request, 768Mi limit       | Container resources.                                                                                       |
| `serviceAccount.create`                   | `true`                           | Create a ServiceAccount. Its token is not mounted.                                                         |
| `serviceAccount.name`                     | `""`                             | Name to use. Empty means the release's full name.                                                          |
| `serviceAccount.annotations`              | `{}`                             | ServiceAccount annotations.                                                                                |
| `podAnnotations`, `podLabels`             | `{}`                             | Extra pod metadata.                                                                                        |
| `nodeSelector`, `tolerations`, `affinity` | `{}`, `[]`, `{}`                 | Pod scheduling.                                                                                            |

There is no `replicaCount`. The app needs one replica and a volume that one pod can use, so the chart fixes the replica count at 1 and the strategy at `Recreate`.

## Webhook secret

```sh
helm upgrade --install tcg-gauntlet ... --set webhook.secret="$(openssl rand -hex 32)"
```

Or create the Secret yourself and name it:

```sh
kubectl create secret generic gauntlet-webhook -n tcg-gauntlet --from-literal=webhook-secret="$(openssl rand -hex 32)"
helm upgrade --install tcg-gauntlet ... --set webhook.existingSecret=gauntlet-webhook
```

Use the same value as the "Secret" of the GitHub webhook. Without a secret the webhook is off and the app polls the deck repo.

See [docs/hosting.md](../../../docs/hosting.md) for every app setting.
