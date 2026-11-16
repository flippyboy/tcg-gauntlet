// Build tooling. tsc does not emit the generated validators (plain JavaScript with
// a hand-placed .d.ts), so the build copies them next to the compiled output.
import { copyFileSync, mkdirSync } from "node:fs";

const dir = new URL("../dist/generated/", import.meta.url);
mkdirSync(dir, { recursive: true });
for (const file of ["validators.js", "validators.d.ts"]) {
  copyFileSync(
    new URL(`../src/generated/${file}`, import.meta.url),
    new URL(file, dir),
  );
}
