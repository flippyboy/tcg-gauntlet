// Build tooling. `init` writes the deck-repo template, so the build copies the
// repo's template/ folder into dist/template, where the published image finds it.
import { chmodSync, cpSync, rmSync } from "node:fs";

const from = new URL("../../../template/", import.meta.url);
const to = new URL("../dist/template/", import.meta.url);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });

// The bin file must be executable for `npm link`, and for the Docker image's symlink.
chmodSync(new URL("../dist/cli.js", import.meta.url), 0o755);
