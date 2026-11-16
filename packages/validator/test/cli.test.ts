import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runConformance } from "@tcg-gauntlet/conformance";
import { openCurrent } from "@tcg-gauntlet/carddata";
import { type Report, runCli } from "../src/index.js";
import { type TestServer, startServer } from "./server.js";
import {
  type Files,
  casesDir,
  caseDeck,
  commit,
  makeRepo,
  presetsDir,
  repoRoot,
  tmp,
} from "./helpers.js";

let server: TestServer;
/** A data dir that already holds the mini fixture, made by the first run. */
let warm: string;

beforeAll(async () => {
  server = await startServer();
  vi.stubEnv("MTGJSON_BASE_URL", server.url);
  vi.stubEnv("TCG_GAUNTLET_MIN_CARDS", "100");
  vi.stubEnv("PRESETS_DIR", "");
  vi.stubEnv("GITHUB_STEP_SUMMARY", "");
  vi.stubEnv("GITHUB_WORKSPACE", "");
  warm = tmp("data-");
  const code = await cli(["--all", "--data-dir", warm], goodRepo());
  expect(code.code).toBe(0);
  expect(server.requests).toContain("/AllPrintings.sqlite.gz");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await server.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const BURN = caseDeck("legal-burn");
const BAD = caseDeck("copies-5-lightning-bolt");
const GAUNTLET =
  "schema_version: 1\nname: Test\nformat: preset:2015-modern@1\n";
const goodRepo = (): string =>
  makeRepo({ "g/gauntlet.yaml": GAUNTLET, "g/burn.txt": BURN });

interface Run {
  code: number;
  out: string;
  err: string;
}

/** Runs the CLI in this process, inside `cwd` when it is given. */
async function cli(args: string[], repo?: string): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const argv = repo === undefined ? args : ["--repo", repo, ...args];
  const code = await runCli(argv, {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
  });
  return { code, out: out.join(""), err: err.join("") };
}

/** A fresh copy of the warm data dir, so a test can damage it. */
function copyData(): string {
  const dir = tmp("data-copy-");
  cpSync(warm, dir, { recursive: true });
  return dir;
}

const DEAD = "http://127.0.0.1:1";

async function json(args: string[], repo: string): Promise<Report> {
  const r = await cli([...args, "--output", "json"], repo);
  return JSON.parse(r.out) as Report;
}

const checked = (r: Report): string[] =>
  r.results.filter((x) => x.formatKey !== null).map((x) => x.path);

describe("exit codes", () => {
  it("exits 0 for a repo with no errors", async () => {
    const r = await cli(["--all", "--data-dir", warm], goodRepo());
    expect(r).toEqual({
      code: 0,
      out: "1 deck checked, 0 errors, 0 warnings.\n",
      err: "",
    });
  });

  it("exits 1 when a deck has an error, and prints it as path:line CODE message", async () => {
    const repo = makeRepo({
      "g/gauntlet.yaml": GAUNTLET,
      "g/burn.txt": BURN,
      "g/bad.txt": BAD,
    });
    const r = await cli(["--all", "--data-dir", warm], repo);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^g\/bad\.txt\n {2}g\/bad\.txt:13 E-DECK-COPIES /m);
    expect(r.out).toContain("2 decks checked, 1 error, 0 warnings.");
    expect(r.out).not.toContain("g/burn.txt");
  });

  it("exits 0 when there are only warnings", async () => {
    const repo = makeRepo({
      "g/gauntlet.yaml": GAUNTLET,
      "g/burn.txt": BURN,
      "g/orphan.md": "no deck here\n",
    });
    const r = await cli(["--all", "--data-dir", warm], repo);
    expect(r.code).toBe(0);
    expect(r.out).toContain("  g/orphan.md W-PRIMER-ORPHAN");
    expect(r.out).toContain("0 errors, 1 warning.");
  });

  it("prints suggestions as (did you mean …)", async () => {
    const repo = makeRepo({
      "g/gauntlet.yaml": GAUNTLET,
      "g/typos.txt": caseDeck("unknown-card-typos"),
    });
    const r = await cli(["--all", "--data-dir", warm], repo);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/E-CARD-UNKNOWN .*\(did you mean /);
  });

  it("exits 1 for a bad gauntlet.yaml, a bad format and unknown presets, without checking their decks", async () => {
    const repo = makeRepo({
      "a/gauntlet.yaml": "name: A\nformat: preset:nope@1\n",
      "a/burn.txt": BURN,
      "b/gauntlet.yaml": "name: B\nformat: repo:formats/x.yaml\n",
      "b/burn.txt": BURN,
      "formats/x.yaml": [
        "schema_version: 1",
        "id: x",
        "name: X",
        "legality_by: name",
        "sets: [M11]",
        "banned: [Not A Card]",
        "",
      ].join("\n"),
      "c/gauntlet.yaml": "name: C\nunknown: 1\nformat: modern\n",
      "c/burn.txt": BURN,
    });
    const rep = await json(["--all", "--data-dir", warm], repo);
    const codes = rep.results.flatMap((r) =>
      r.violations.map((v) => `${r.path} ${v.code}`),
    );
    expect(codes).toContain("a/gauntlet.yaml E-FORMAT-UNKNOWN");
    expect(codes).toContain("formats/x.yaml E-FORMAT-INVALID");
    expect(codes).toContain("c/gauntlet.yaml E-SCHEMA-INVALID");
    expect(checked(rep)).toHaveLength(0);
    expect(checked(rep)).toEqual([]);
  });

  it("exits 2 when there is no card data", async () => {
    vi.stubEnv("MTGJSON_BASE_URL", DEAD);
    try {
      const r = await cli(["--all", "--data-dir", tmp("empty-")], goodRepo());
      expect(r.code).toBe(2);
      expect(r.out).toBe("");
      expect(r.err).toMatch(/No usable card data/);
      expect(r.err).toMatch(/no cached copy/);
    } finally {
      vi.stubEnv("MTGJSON_BASE_URL", server.url);
    }
  });

  it("exits 2 when the refresh fails and the cached data is damaged", async () => {
    const data = copyData();
    const dir = join(data, "mtgjson");
    const version = readdirSync(dir).find((n) => n !== "current.json")!;
    truncateSync(join(dir, version, "AllPrintings.sqlite"), 100);
    vi.stubEnv("MTGJSON_BASE_URL", DEAD);
    try {
      const r = await cli(["--all", "--data-dir", data], goodRepo());
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/damaged/);
    } finally {
      vi.stubEnv("MTGJSON_BASE_URL", server.url);
    }
  });

  it("exits 2 when the presets folder is missing", async () => {
    const r = await cli(
      ["--all", "--data-dir", warm, "--presets-dir", "/nonexistent/presets"],
      goodRepo(),
    );
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/presets folder .* does not exist/);
  });
});

describe("usage errors (exit 2)", () => {
  const cases: [string, string[], RegExp][] = [
    [
      "neither --all nor --changed-since",
      [],
      /either --all or --changed-since/,
    ],
    [
      "both --all and --changed-since",
      ["--all", "--changed-since", "HEAD"],
      /cannot be used together/,
    ],
    [
      "a ref that does not resolve",
      ["--changed-since", "nope"],
      /does not resolve/,
    ],
    ["an empty ref", ["--changed-since", ""], /needs a git ref/],
    ["a bad --output", ["--all", "--output", "xml"], /--output must be one of/],
    ["an unknown flag", ["--all", "--bogus"], /bogus/],
    ["a flag without its value", ["--all", "--data-dir"], /data-dir/],
    [
      "an unknown command",
      ["frobnicate", "--all"],
      /Unknown command: frobnicate/,
    ],
    [
      "a second argument",
      ["validate", "extra", "--all"],
      /Unexpected argument: extra/,
    ],
    [
      "--format on validate",
      ["--all", "--format", "modern"],
      /belongs to the init/,
    ],
    [
      "a missing --repo folder",
      ["--all", "--repo", "/nonexistent/dir"],
      /is not a folder/,
    ],
  ];
  for (const [name, args, message] of cases) {
    it(name, async () => {
      const r = await cli(["--data-dir", warm, ...args]);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(message);
      expect(r.err).toContain("Usage:");
      expect(r.out).toBe("");
    });
  }

  it("an invalid TCG_GAUNTLET_MIN_CARDS", async () => {
    vi.stubEnv("TCG_GAUNTLET_MIN_CARDS", "lots");
    try {
      const r = await cli(["--all", "--data-dir", warm], goodRepo());
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/TCG_GAUNTLET_MIN_CARDS/);
    } finally {
      vi.stubEnv("TCG_GAUNTLET_MIN_CARDS", "100");
    }
  });

  it("a ref that does not resolve makes no network request", async () => {
    const before = server.requests.length;
    const r = await cli(
      ["--changed-since", "nope", "--data-dir", tmp("d-")],
      goodRepo(),
    );
    expect(r.code).toBe(2);
    expect(server.requests.length).toBe(before);
  });

  it("init with validate-only flags, and with a bad --format", async () => {
    const dir = tmp("init-bad-");
    for (const [args, message] of [
      [["init", "--all"], /--all belongs/],
      [["init", "--changed-since", "main"], /--changed-since belongs/],
      [["init", "--presets-dir", "x"], /--presets-dir belongs/],
      [["init", "--format", "fancy"], /--format: "fancy" is not a format/],
    ] as [string[], RegExp][]) {
      const r = await cli(args, dir);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(message);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it("--help prints the usage and exits 0", async () => {
    const r = await cli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("tcg-gauntlet-validate init");
  });
});

describe("presets folder", () => {
  it("--presets-dir and PRESETS_DIR both work, and the flag wins", async () => {
    const repo = goodRepo();
    const flag = await cli(
      ["--all", "--data-dir", warm, "--presets-dir", presetsDir],
      repo,
    );
    expect(flag.code).toBe(0);
    vi.stubEnv("PRESETS_DIR", presetsDir);
    const env = await cli(["--all", "--data-dir", warm], repo);
    expect(env.code).toBe(0);
    vi.stubEnv("PRESETS_DIR", "/nonexistent");
    const both = await cli(
      ["--all", "--data-dir", warm, "--presets-dir", presetsDir],
      repo,
    );
    expect(both.code).toBe(0);
    const bad = await cli(["--all", "--data-dir", warm], repo);
    expect(bad.code).toBe(2);
    vi.stubEnv("PRESETS_DIR", "");
  });
});

describe("output formats", () => {
  const badRepo = (): string =>
    makeRepo({
      "g/gauntlet.yaml": GAUNTLET,
      "g/burn.txt": BURN,
      "g/bad.txt": BAD,
      "g/orphan.md": "x\n",
    });

  it("json has engineVersion, mtgjson and results with formatKey and violations", async () => {
    const r = await cli(
      ["--all", "--data-dir", warm, "--output", "json"],
      badRepo(),
    );
    expect(r.code).toBe(1);
    const rep = JSON.parse(r.out) as Report;
    expect(Object.keys(rep)).toEqual(["engineVersion", "mtgjson", "results"]);
    expect(rep.engineVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(rep.mtgjson).toEqual({
      version: "5.3.0+20261115",
      date: "2026-11-15",
    });
    expect(rep.results.map((x) => x.path)).toEqual([
      "g/bad.txt",
      "g/burn.txt",
      "g/orphan.md",
    ]);
    const bad = rep.results[0]!;
    expect(bad.formatKey).toMatch(/^preset:2015-modern@1#[0-9a-f]+$/);
    expect(bad.violations).toMatchObject([
      { code: "E-DECK-COPIES", severity: "error", file: "g/bad.txt", line: 13 },
    ]);
    expect(rep.results[1]!.violations).toEqual([]);
    expect(rep.results[2]!).toMatchObject({
      formatKey: null,
      violations: [{ code: "W-PRIMER-ORPHAN", severity: "warning" }],
    });
  });

  describe("github", () => {
    function capture(): string[] {
      const lines: string[] = [];
      vi.spyOn(process.stdout, "write").mockImplementation(
        (s: string | Uint8Array) => {
          lines.push(String(s));
          return true;
        },
      );
      return lines;
    }

    it("writes annotations and a summary table, with paths relative to the workspace", async () => {
      const repo = badRepo();
      const workspace = tmp("workspace-");
      const sub = join(workspace, "decks");
      cpSync(repo, sub, { recursive: true });
      const summary = join(tmp("summary-"), "summary.md");
      writeFileSync(summary, "");
      vi.stubEnv("GITHUB_STEP_SUMMARY", summary);
      vi.stubEnv("GITHUB_WORKSPACE", workspace);
      const lines = capture();
      const r = await cli(
        ["--all", "--data-dir", warm, "--output", "github"],
        sub,
      );
      expect(r.code).toBe(1);
      expect(r.out).toBe("");
      const text = lines.join("");
      expect(text).toMatch(
        /::error title=E-DECK-COPIES,file=decks\/g\/bad\.txt,line=13::/,
      );
      expect(text).toMatch(
        /::warning title=W-PRIMER-ORPHAN,file=decks\/g\/orphan\.md::/,
      );
      expect(text).toContain("2 deck(s) checked, 1 error(s), 1 warning(s).");
      const md = readFileSync(summary, "utf8");
      expect(md).toContain("<h2>TCG Gauntlet validation</h2>");
      expect(md).toContain("<table>");
      expect(md).toContain("decks/g/bad.txt".replace("decks/", ""));
      expect(md).toContain("1 error");
      expect(md).toContain("ok</td>");
      expect(md).toContain("E-DECK-COPIES (line 13)");
      expect(md).toContain("MTGJSON 5.3.0+20261115");
    });

    it("uses repo-relative paths with no workspace, and no summary without the file", async () => {
      const lines = capture();
      const r = await cli(
        ["--all", "--data-dir", warm, "--output", "github"],
        badRepo(),
      );
      expect(r.code).toBe(1);
      expect(lines.join("")).toMatch(
        /::error title=E-DECK-COPIES,file=g\/bad\.txt,line=13::/,
      );
    });

    it("annotates a repo-wide warning without a file", async () => {
      const lines = capture();
      vi.stubEnv("MTGJSON_BASE_URL", DEAD);
      try {
        const r = await cli(
          ["--all", "--data-dir", copyData(), "--output", "github"],
          goodRepo(),
        );
        expect(r.code).toBe(0);
      } finally {
        vi.stubEnv("MTGJSON_BASE_URL", server.url);
      }
      expect(lines.join("")).toMatch(
        /::warning title=W-STALE-DATA::The card data could not be refreshed/,
      );
    });

    it("keeps a workspace path outside the workspace repo-relative", async () => {
      vi.stubEnv("GITHUB_WORKSPACE", tmp("elsewhere-"));
      const lines = capture();
      await cli(["--all", "--data-dir", warm, "--output", "github"], badRepo());
      expect(lines.join("")).toMatch(/file=g\/bad\.txt,line=13/);
    });
  });
});

describe("the warm-cache fallback", () => {
  it("continues on cached data with W-STALE-DATA and exits 0", async () => {
    vi.stubEnv("MTGJSON_BASE_URL", DEAD);
    try {
      const data = copyData();
      const r = await cli(["--all", "--data-dir", data], goodRepo());
      expect(r.code).toBe(0);
      expect(r.out).toContain("(card data)");
      expect(r.out).toMatch(
        /W-STALE-DATA The card data could not be refreshed/,
      );
      expect(r.out).toContain("cached MTGJSON 5.3.0+20261115 from 2026-11-15");
      expect(r.out).toContain("1 deck checked, 0 errors, 1 warning.");
    } finally {
      vi.stubEnv("MTGJSON_BASE_URL", server.url);
    }
  });

  it("still exits 1 when a deck has an error", async () => {
    vi.stubEnv("MTGJSON_BASE_URL", DEAD);
    try {
      const repo = makeRepo({ "g/gauntlet.yaml": GAUNTLET, "g/bad.txt": BAD });
      const rep = await json(["--all", "--data-dir", copyData()], repo);
      const codes = rep.results.flatMap((r) => r.violations.map((v) => v.code));
      expect(codes).toEqual(["W-STALE-DATA", "E-DECK-COPIES"]);
      expect(rep.results[0]!.path).toBe("");
    } finally {
      vi.stubEnv("MTGJSON_BASE_URL", server.url);
    }
  });

  it("works the first time and then again with the server down", async () => {
    const s = await startServer();
    const data = tmp("data-cold-");
    const repo = goodRepo();
    try {
      vi.stubEnv("MTGJSON_BASE_URL", s.url);
      const first = await cli(["--all", "--data-dir", data], repo);
      expect(first.code).toBe(0);
      expect(first.out).not.toContain("W-STALE-DATA");
      // A second run asks only for Meta.json.
      const before = s.requests.length;
      await cli(["--all", "--data-dir", data], repo);
      expect(s.requests.slice(before)).toEqual(["/Meta.json"]);
    } finally {
      await s.close();
    }
    const down = await cli(["--all", "--data-dir", data], repo);
    vi.stubEnv("MTGJSON_BASE_URL", server.url);
    expect(down.code).toBe(0);
    expect(down.out).toContain("W-STALE-DATA");
  });
});

describe("--changed-since", () => {
  const FORMAT = [
    "schema_version: 1",
    "id: cube",
    "name: Cube",
    "legality_by: name",
    "sets: [M11, ZEN]",
    "",
  ].join("\n");
  const base: Files = {
    "one/gauntlet.yaml": GAUNTLET,
    "one/burn.txt": BURN,
    "one/burn.md": "Primer\n",
    "one/second.txt": BURN,
    "two/gauntlet.yaml": GAUNTLET,
    "two/bad.txt": BAD,
    "three/gauntlet.yaml": "name: Three\nformat: repo:formats/cube.yaml\n",
    "three/one.txt": BURN,
    "formats/cube.yaml": FORMAT,
  };

  it("checks only the deck that changed", async () => {
    const repo = makeRepo(base);
    commit(repo, { "one/burn.txt": BAD });
    const rep = await json(
      ["--changed-since", "HEAD~1", "--data-dir", warm],
      repo,
    );
    expect(checked(rep)).toEqual(["one/burn.txt"]);
    expect(checked(rep)).toHaveLength(1);
    // two/bad.txt is invalid too, but it did not change.
    expect(rep.results.flatMap((r) => r.violations.map((v) => v.code))).toEqual(
      ["E-DECK-COPIES"],
    );
    const text = await cli(
      ["--changed-since", "HEAD~1", "--data-dir", warm],
      repo,
    );
    expect(text.code).toBe(1);
  });

  it("prints 'No decks affected.' and exits 0 when nothing relevant changed", async () => {
    const repo = makeRepo(base);
    commit(repo, { "notes.txt": "not in a gauntlet\n", "README.md": "hi\n" });
    const r = await cli(
      ["--changed-since", "HEAD~1", "--data-dir", warm],
      repo,
    );
    expect(r).toEqual({
      code: 0,
      out: "No decks affected.\n0 decks checked, 0 errors, 0 warnings.\n",
      err: "",
    });
    const same = await cli(
      ["--changed-since", "HEAD", "--data-dir", warm],
      repo,
    );
    expect(same.code).toBe(0);
    expect(
      (await json(["--changed-since", "HEAD", "--data-dir", warm], repo))
        .results,
    ).toEqual([]);
  });

  it("checks every deck of a gauntlet when its gauntlet.yaml changes", async () => {
    const repo = makeRepo(base);
    commit(repo, { "one/gauntlet.yaml": GAUNTLET + "description: new\n" });
    const rep = await json(
      ["--changed-since", "HEAD~1", "--data-dir", warm],
      repo,
    );
    expect(checked(rep)).toEqual(["one/burn.txt", "one/second.txt"]);
  });

  it("reports a gauntlet.yaml that broke, although none of its decks changed", async () => {
    const repo = makeRepo(base);
    commit(repo, { "one/gauntlet.yaml": "name: x\n" });
    const rep = await json(
      ["--changed-since", "HEAD~1", "--data-dir", warm],
      repo,
    );
    expect(
      rep.results.map((r) => [r.path, r.violations.map((v) => v.code)]),
    ).toEqual([["one/gauntlet.yaml", ["E-SCHEMA-INVALID"]]]);
  });

  it("selects by a primer change, and reports an orphan primer that changed", async () => {
    const repo = makeRepo(base);
    commit(repo, { "one/burn.md": "New primer\n", "two/ghost.md": "x\n" });
    const rep = await json(
      ["--changed-since", "HEAD~1", "--data-dir", warm],
      repo,
    );
    expect(checked(rep)).toEqual(["one/burn.txt"]);
    expect(
      rep.results.find((r) => r.path === "two/ghost.md")?.violations[0]?.code,
    ).toBe("W-PRIMER-ORPHAN");
  });

  it("reports E-FORMAT-UNKNOWN when a format file is deleted", async () => {
    const repo = makeRepo(base);
    commit(repo, { "formats/cube.yaml": null });
    const r = await cli(
      ["--changed-since", "HEAD~1", "--data-dir", warm, "--output", "json"],
      repo,
    );
    expect(r.code).toBe(1);
    const rep = JSON.parse(r.out) as Report;
    expect(rep.results).toMatchObject([
      {
        path: "three/gauntlet.yaml",
        violations: [{ code: "E-FORMAT-UNKNOWN" }],
      },
    ]);
  });

  it("checks the decks of a gauntlet whose format file changed", async () => {
    const repo = makeRepo(base);
    commit(repo, {
      "formats/cube.yaml": FORMAT.replace("[M11, ZEN]", "[M11]"),
    });
    const rep = await json(
      ["--changed-since", "HEAD~1", "--data-dir", warm],
      repo,
    );
    expect(checked(rep)).toEqual(["three/one.txt"]);
    // Burn has cards from ZEN, which the new pool leaves out.
    expect(
      rep.results
        .find((r) => r.path === "three/one.txt")
        ?.violations.map((v) => v.code),
    ).toContain("E-LEGAL-NOT-IN-POOL");
  });

  it("checks a new format file that no gauntlet uses yet", async () => {
    const repo = makeRepo(base);
    commit(repo, {
      "formats/other.yaml": FORMAT.replace("id: cube", "id: other").replace(
        "sets:",
        "banned: [Not A Card]\nsets:",
      ),
    });
    const rep = await json(
      ["--changed-since", "HEAD~1", "--data-dir", warm],
      repo,
    );
    expect(rep.results).toMatchObject([
      {
        path: "formats/other.yaml",
        violations: [{ code: "E-FORMAT-INVALID" }],
      },
    ]);
  });

  it("works with a branch name as the base, and for a deleted deck", async () => {
    const repo = makeRepo(base);
    commit(repo, { "one/second.txt": null });
    const r = await cli(
      ["--changed-since", "HEAD~1", "--data-dir", warm],
      repo,
    );
    expect(r.out).toContain("No decks affected.");
    const main = await cli(
      ["--changed-since", "main", "--data-dir", warm],
      repo,
    );
    expect(main.code).toBe(0);
  });
});

describe("init", () => {
  const templateFiles = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === ".git") continue;
        if (e.isDirectory()) walk(join(d, e.name));
        else out.push(relative(dir, join(d, e.name)));
      }
    };
    walk(dir);
    return out.sort();
  };

  it("writes the template into an empty folder and prints the next steps", async () => {
    const dir = tmp("init-");
    const r = await cli(["init"], dir);
    expect(r.code).toBe(0);
    expect(templateFiles(dir)).toEqual(templateFiles(`${repoRoot}template`));
    expect(templateFiles(dir)).toEqual([
      ".github/workflows/validate.yml",
      "CONTRIBUTING.md",
      "README.md",
      "formats/README.md",
      "modern-2015-example/burn.md",
      "modern-2015-example/burn.txt",
      "modern-2015-example/gauntlet.md",
      "modern-2015-example/gauntlet.yaml",
    ]);
    for (const f of templateFiles(dir))
      expect(readFileSync(join(dir, f))).toEqual(
        readFileSync(`${repoRoot}template/${f}`),
      );
    expect(r.out).toContain("Wrote 8 file(s).");
    expect(r.out).toContain("Add branch protection rule");
    expect(r.out).toContain("select the check named validate");
    expect(
      readFileSync(join(dir, ".github/workflows/validate.yml"), "utf8"),
    ).toContain("uses: __ACTION_REF__");
  });

  it("sets the format of the example gauntlet", async () => {
    const dir = tmp("init-format-");
    const r = await cli(["init", "--format", "modern"], dir);
    expect(r.code).toBe(0);
    expect(
      readFileSync(join(dir, "modern-2015-example/gauntlet.yaml"), "utf8"),
    ).toContain("\nformat: modern\n");
    expect(r.out).toContain("not in modern");
    const preset = await cli(
      ["init", "--format", "preset:2015-modern@1"],
      tmp("i-"),
    );
    expect(preset.out).not.toContain("not in");
  });

  it("does not overwrite files in a folder that is not empty", async () => {
    const dir = tmp("init-nonempty-");
    mkdirSync(join(dir, "modern-2015-example"));
    writeFileSync(join(dir, "README.md"), "my readme\n");
    writeFileSync(
      join(dir, "modern-2015-example/gauntlet.yaml"),
      "name: Mine\nformat: legacy\n",
    );
    writeFileSync(join(dir, "other.txt"), "keep\n");
    const r = await cli(["init", "--format", "modern"], dir);
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("my readme\n");
    // Not even --format changes a file that was already there.
    expect(
      readFileSync(join(dir, "modern-2015-example/gauntlet.yaml"), "utf8"),
    ).toBe("name: Mine\nformat: legacy\n");
    expect(readFileSync(join(dir, "other.txt"), "utf8")).toBe("keep\n");
    expect(existsSync(join(dir, "CONTRIBUTING.md"))).toBe(true);
    expect(r.out).toContain("Wrote 6 file(s).");
    expect(r.out).toContain("Left 2 existing file(s) alone:");
    expect(r.out).toContain("  README.md");
  });

  it("creates the folder when it does not exist, and a second run changes nothing", async () => {
    const dir = join(tmp("init-new-"), "deep", "decks");
    expect((await cli(["init"], dir)).code).toBe(0);
    const mtime = statSync(join(dir, "README.md")).mtimeMs;
    const again = await cli(["init"], dir);
    expect(again.out).toContain("Wrote 0 file(s).");
    expect(statSync(join(dir, "README.md")).mtimeMs).toBe(mtime);
  });

  it("produces a repo that validates (the template passes with --all)", async () => {
    const dir = tmp("init-valid-");
    await cli(["init"], dir);
    const r = await cli(["--all", "--data-dir", warm], dir);
    expect(r.out).toBe("1 deck checked, 0 errors, 0 warnings.\n");
    expect(r.code).toBe(0);
  });
});

describe("conformance parity", () => {
  it("gives the same violations through the CLI as runConformance does", async () => {
    interface Case {
      format: string;
      expectedViolations: { code: string; line?: number }[];
    }
    const names = readdirSync(casesDir).sort();
    const specs = new Map<string, Case>();
    const files: Files = {};
    const folderOf = (format: string): string =>
      `g-${format.replace(/[^a-z0-9]+/g, "-")}`;
    for (const n of names) {
      const spec = JSON.parse(
        readFileSync(join(casesDir, n, "case.json"), "utf8"),
      ) as Case;
      specs.set(n, spec);
      const folder = folderOf(spec.format);
      files[`${folder}/gauntlet.yaml`] =
        `name: ${folder}\nformat: ${spec.format}\n`;
      files[`${folder}/${n}.txt`] = caseDeck(n);
    }
    const repo = makeRepo(files);
    const rep = await json(["--all", "--data-dir", warm], repo);
    expect(checked(rep)).toHaveLength(names.length);

    const describeAll = (
      vs: { code: string; line?: number | undefined }[],
    ): string[] => vs.map((v) => `${v.code}@${v.line ?? ""}`).sort();
    for (const n of names) {
      const spec = specs.get(n)!;
      const got = rep.results.find(
        (r) => r.path === `${folderOf(spec.format)}/${n}.txt`,
      );
      expect(got, n).toBeDefined();
      expect(describeAll(got!.violations), n).toEqual(
        describeAll(spec.expectedViolations),
      );
    }

    // And the engine's own run, over the same card data, agrees with the corpus.
    const opened = await openCurrent(warm);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      expect(
        await runConformance(opened.lookup, { casesDir, presetsDir }),
      ).toEqual([]);
    } finally {
      opened.lookup.close();
    }
  });
});

describe("the built program", () => {
  const bin = join(repoRoot, "packages/validator/dist/cli.js");
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [bin, ...args], {
      encoding: "utf8",
      env: { PATH: process.env["PATH"], ...env },
    });

  it("runs as a program: exit codes 0, 1 and 2", () => {
    const data = tmp("bin-data-");
    const env = {
      MTGJSON_BASE_URL: DEAD,
      TCG_GAUNTLET_MIN_CARDS: "100",
    };
    expect(run(["--help"]).status).toBe(0);
    const usage = run([]);
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain("either --all or --changed-since");
    // No data and a dead server.
    const none = run(["--all", "--repo", goodRepo(), "--data-dir", data], env);
    expect(none.status).toBe(2);
    expect(none.stderr).toContain("No usable card data");
    expect(existsSync(bin)).toBe(true);
  });

  it("is executable and starts with a node shebang", () => {
    expect(readFileSync(bin, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(
      true,
    );
    expect(statSync(bin).mode & 0o111).not.toBe(0);
  });
});
