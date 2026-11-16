#!/usr/bin/env node
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { init, nextSteps } from "./init.js";
import { writeGithub as formatGithub } from "./output/github.js";
import { formatJson } from "./output/json.js";
import { formatText } from "./output/text.js";
import { OUTPUT_MODES, type OutputMode, exitCodeOf } from "./types.js";
import { validate } from "./validate.js";

export const USAGE = `Usage:
  tcg-gauntlet-validate [validate] [--repo <dir>] [--data-dir <dir>]
                        (--changed-since <git-ref> | --all)
                        [--output text|json|github] [--presets-dir <dir>]
  tcg-gauntlet-validate init [--repo <dir>] [--format <ref>]

Exit codes: 0 no errors (warnings allowed), 1 errors found,
            2 no usable card data, or a usage error.

Environment: MTGJSON_BASE_URL (default https://mtgjson.com/api/v5),
             PRESETS_DIR (the presets folder; --presets-dir overrides it).
`;

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

const stdio: Io = {
  out: (t) => void process.stdout.write(t),
  err: (t) => void process.stderr.write(t),
};

class UsageError extends Error {}

const DEFAULT_BASE_URL = "https://mtgjson.com/api/v5";

/**
 * The presets folder. `--presets-dir` wins, then `PRESETS_DIR` (the Docker image sets
 * it to /app/presets), then the `presets/` folder of the monorepo this file is in.
 * The last one works only when running from a checkout.
 */
export function presetsDirFrom(flag: string | undefined): string {
  const fromEnv = process.env["PRESETS_DIR"];
  if (flag !== undefined && flag !== "") return resolve(flag);
  if (fromEnv !== undefined && fromEnv !== "") return resolve(fromEnv);
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../presets");
}

function minCardsFromEnv(): number | undefined {
  // Test-only: the self-check wants 20,000 names, and the mini fixture has fewer.
  const raw = process.env["TCG_GAUNTLET_MIN_CARDS"];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0)
    throw new UsageError("TCG_GAUNTLET_MIN_CARDS must be a whole number");
  return n;
}

/**
 * Runs the CLI and returns the exit code. Output goes to `io`, except the
 * annotations and the step summary of `--output github`, which go through
 * `@actions/core` (standard output and `GITHUB_STEP_SUMMARY`).
 */
export async function runCli(
  argv: readonly string[],
  io: Io = stdio,
): Promise<number> {
  try {
    return await run(argv, io);
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`${e.message}\n\n${USAGE}`);
      return 2;
    }
    io.err(
      `tcg-gauntlet-validate: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }
}

async function run(argv: readonly string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        repo: { type: "string", default: "." },
        "data-dir": { type: "string", default: "./.tcg-gauntlet-cache" },
        "changed-since": { type: "string" },
        all: { type: "boolean", default: false },
        output: { type: "string", default: "text" },
        "presets-dir": { type: "string" },
        format: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (e) {
    throw new UsageError((e as Error).message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(USAGE);
    return 0;
  }
  if (positionals.length > 1)
    throw new UsageError(`Unexpected argument: ${positionals[1]}`);
  const command = positionals[0] ?? "validate";
  if (command !== "validate" && command !== "init")
    throw new UsageError(`Unknown command: ${command}`);

  const repoDir = resolve(values.repo);
  if (command === "init") return runInit(repoDir, values, io);

  if (values.format !== undefined)
    throw new UsageError("--format belongs to the init command");
  const since = values["changed-since"];
  if (values.all && since !== undefined)
    throw new UsageError("--all and --changed-since cannot be used together");
  if (!values.all && since === undefined)
    throw new UsageError("Give either --all or --changed-since <git-ref>");
  if (since === "") throw new UsageError("--changed-since needs a git ref");
  const mode = values.output as OutputMode;
  if (!OUTPUT_MODES.includes(mode))
    throw new UsageError(
      `--output must be one of ${OUTPUT_MODES.join(", ")}, not "${values.output}"`,
    );
  if (!existsSync(repoDir) || !statSync(repoDir).isDirectory())
    throw new UsageError(`--repo: ${repoDir} is not a folder`);
  const minCards = minCardsFromEnv();
  const presetsDir = presetsDirFrom(values["presets-dir"]);
  if (!existsSync(presetsDir))
    throw new Error(
      `The presets folder ${presetsDir} does not exist. Set PRESETS_DIR or pass --presets-dir.`,
    );

  const outcome = await validate({
    repoDir,
    dataDir: resolve(values["data-dir"]),
    presetsDir,
    selection: since === undefined ? { all: true } : { changedSince: since },
    baseUrl: process.env["MTGJSON_BASE_URL"] || DEFAULT_BASE_URL,
    minCards,
  });
  if (outcome.kind === "usage") throw new UsageError(outcome.message);
  if (outcome.kind === "infrastructure") {
    io.err(`${outcome.message}\n`);
    return 2;
  }
  const { report } = outcome;
  if (mode === "json") io.out(formatJson(report));
  else if (mode === "github")
    await formatGithub(report, {
      repoDir,
      workspace: process.env["GITHUB_WORKSPACE"],
    });
  else io.out(formatText(report));
  return exitCodeOf(report);
}

function runInit(
  repoDir: string,
  values: { [k: string]: string | boolean | undefined },
  io: Io,
): number {
  for (const flag of ["changed-since", "presets-dir"])
    if (values[flag] !== undefined)
      throw new UsageError(`--${flag} belongs to the validate command`);
  if (values["all"] === true)
    throw new UsageError("--all belongs to the validate command");
  const format = values["format"] as string | undefined;
  let result;
  try {
    result = init({ repoDir, format });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("--format"))
      throw new UsageError(e.message);
    throw e;
  }
  io.out(nextSteps(result, format));
  return 0;
}

// Run when this file is the program, not when a test or another module imports it.
const entry = process.argv[1];
if (
  entry !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(entry)).href
) {
  process.exitCode = await runCli(process.argv.slice(2));
}
