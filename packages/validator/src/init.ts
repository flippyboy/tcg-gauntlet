import {
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFormatRef } from "@tcg-gauntlet/engine";

/** The gauntlet whose `format` line `--format` changes. */
const EXAMPLE_GAUNTLET = "modern-2015-example/gauntlet.yaml";

export interface InitOptions {
  /** The folder to write into. */
  repoDir: string;
  /** `--format`: a format reference for the example gauntlet. */
  format?: string | undefined;
  /** The template folder. Default: the one bundled with this package. */
  templateDir?: string | undefined;
}

export interface InitResult {
  written: string[];
  skipped: string[];
}

/**
 * The bundled template: `dist/template` in a built package. Running from the
 * monorepo's source (the tests), it is the repo's own `template/`.
 */
export function bundledTemplateDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["template", "../../../template"]) {
    const dir = join(here, rel);
    if (existsSync(join(dir, "README.md"))) return dir;
  }
  throw new Error("The bundled template folder is missing.");
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, base));
    else if (e.isFile()) out.push(relative(base, abs));
  }
  return out.sort();
}

/** Throws an Error with a usage message for a bad `--format`. */
export function checkFormatRef(format: string): void {
  if (parseFormatRef(format) === null) {
    throw new Error(
      `--format: "${format}" is not a format reference. Use preset:<id>@<n>, repo:formats/<file>.yaml, official:<name> or an official name.`,
    );
  }
}

/**
 * Copies the template into `repoDir`. A file that already exists, whatever it holds
 * (even a symlink), is left alone. `--format` rewrites the `format:` line of the
 * example gauntlet, but only in a copy that this call wrote.
 */
export function init(opts: InitOptions): InitResult {
  if (opts.format !== undefined) checkFormatRef(opts.format);
  const from = opts.templateDir ?? bundledTemplateDir();
  const result: InitResult = { written: [], skipped: [] };
  for (const rel of walk(from)) {
    const target = join(opts.repoDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    try {
      lstatSync(target);
      result.skipped.push(rel);
      continue;
    } catch {
      // Missing: write it.
    }
    copyFileSync(join(from, rel), target, constants.COPYFILE_EXCL);
    result.written.push(rel);
    if (opts.format !== undefined && rel === EXAMPLE_GAUNTLET) {
      const text = readFileSync(target, "utf8");
      writeFileSync(
        target,
        text.replace(/^format:.*$/m, `format: ${opts.format}`),
      );
    }
  }
  return result;
}

/** What `init` prints once it is done. */
export function nextSteps(result: InitResult, format?: string): string {
  const lines: string[] = [];
  lines.push(`Wrote ${result.written.length} file(s).`);
  if (result.skipped.length > 0) {
    lines.push(
      `Left ${result.skipped.length} existing file(s) alone:`,
      ...result.skipped.map((f) => `  ${f}`),
    );
  }
  lines.push("", "Next steps:");
  lines.push(
    "  1. Commit the files and push them to GitHub, on the branch main.",
    "  2. Look at modern-2015-example/ and replace the example decks with your own.",
  );
  if (format !== undefined && format !== "preset:2015-modern@1") {
    lines.push(
      `     The example decks are legal in 2015 Modern, not in ${format}. Replace or delete them.`,
    );
  }
  lines.push(
    "  3. Run the validator on your machine:",
    '       docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/w" -w /w \\',
    '         -v "$HOME/.cache/tcg-gauntlet:/cache" ghcr.io/flippyboy/tcg-gauntlet-validator:v1 --data-dir /cache --all',
    "  4. Protect the main branch, so that no deck is merged without a passing check.",
    "     In the repo on GitHub, open Settings > Branches > Add branch protection rule:",
    "       - Branch name pattern: main",
    "       - Require a pull request before merging",
    "       - Require status checks to pass before merging, and select the check named validate",
    "     (The check appears in the list after the workflow has run once.)",
    "     CONTRIBUTING.md has the full steps.",
  );
  return lines.join("\n") + "\n";
}
