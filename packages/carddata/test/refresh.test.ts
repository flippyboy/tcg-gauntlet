import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { ENGINE_VERSION } from "@tcg-gauntlet/engine";
import {
  CardDataError,
  TOOL_SCHEMA,
  derivedPath,
  downloadAllPrintings,
  fetchMeta,
  mtgjsonPath,
  openCurrent,
  readCurrent,
  refreshCardData,
} from "../src/index.js";
import { OFFICIAL_MODERN, modernBuilds, tempDir } from "./helpers.js";
import {
  type TestServer,
  fixtureArchive,
  newState,
  startServer,
} from "./server.js";

const servers: TestServer[] = [];
async function serve(
  version = "5.3.0+20261115",
  date = "2026-11-15",
): Promise<TestServer> {
  const s = await startServer(newState(version, date));
  servers.push(s);
  return s;
}
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});
beforeAll(() => {
  fixtureArchive();
});

const base = (s: TestServer, dataDir: string) => ({
  baseUrl: s.url,
  dataDir,
  minCards: 100,
});

const kind = (e: Error | undefined): string | undefined =>
  e instanceof CardDataError ? e.kind : undefined;

describe("refreshCardData", () => {
  it("downloads, builds and installs a first version", async () => {
    const s = await serve();
    const dataDir = tempDir();
    const { preset, official } = await modernBuilds();
    const r = await refreshCardData({
      ...base(s, dataDir),
      formatDefs: [preset, official],
    });
    expect(r.status).toBe("updated");
    expect(r.error).toBeUndefined();
    expect(r.current).toMatchObject({
      version: "5.3.0+20261115",
      date: "2026-11-15",
      path: "mtgjson/5.3.0_20261115-2026-11-15/AllPrintings.sqlite",
      previous: null,
    });
    expect(r.current?.sha256).toBe(newState("x", "y").rawSha);
    expect(existsSync(mtgjsonPath(dataDir, r.current!))).toBe(true);
    expect(existsSync(derivedPath(dataDir, r.current!))).toBe(true);
    expect(await readCurrent(dataDir)).toEqual(r.current);
    // No temporary files are left behind.
    expect(readdirSync(join(dataDir, "tmp"))).toEqual([]);
    // Every request sent the User-Agent.
    expect(s.requests).toContain("/AllPrintings.sqlite.gz");
    for (const h of s.headers)
      expect(h["user-agent"]).toBe(`tcg-gauntlet/${ENGINE_VERSION}`);

    const opened = await openCurrent(dataDir);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const bolt = opened.lookup.findCard("lightning bolt")!;
    expect(opened.lookup.inPool(preset.key, bolt)).toBe(true);
    expect(opened.lookup.dataVersion()).toBe("mtgjson 5.3.0+20261115");
    expect(opened.lookup.defaultPrinting(OFFICIAL_MODERN, bolt)).not.toBeNull();
    opened.lookup.close();
  });

  it("stops after Meta.json when nothing changed", async () => {
    const s = await serve();
    const dataDir = tempDir();
    await refreshCardData(base(s, dataDir));
    s.requests.length = 0;
    const r = await refreshCardData(base(s, dataDir));
    expect(r.status).toBe("unchanged");
    expect(r.current?.version).toBe("5.3.0+20261115");
    expect(s.requests).toEqual(["/Meta.json"]);
  });

  it("downloads again with force, and when the cached file is gone", async () => {
    const s = await serve();
    const dataDir = tempDir();
    const first = await refreshCardData(base(s, dataDir));
    expect(
      (await refreshCardData({ ...base(s, dataDir), force: true })).status,
    ).toBe("updated");
    rmSync(mtgjsonPath(dataDir, first.current!));
    expect((await refreshCardData(base(s, dataDir))).status).toBe("updated");
    expect(existsSync(mtgjsonPath(dataDir, first.current!))).toBe(true);
  });

  it("switches to a new version and keeps the old one as previous", async () => {
    const s = await serve("5.3.0+20261115", "2026-11-15");
    const dataDir = tempDir();
    await refreshCardData(base(s, dataDir));
    s.state.version = "5.3.1+20261116";
    s.state.date = "2026-11-16";
    const r = await refreshCardData(base(s, dataDir));
    expect(r.status).toBe("updated");
    expect(r.current).toMatchObject({
      version: "5.3.1+20261116",
      previous: { version: "5.3.0+20261115" },
    });
    expect(readdirSync(join(dataDir, "mtgjson")).sort()).toEqual([
      "5.3.0_20261115-2026-11-15",
      "5.3.1_20261116-2026-11-16",
      "current.json",
    ]);
  });

  it("keeps two versions and deletes older ones", async () => {
    const s = await serve("5.3.0+1", "2026-11-01");
    const dataDir = tempDir();
    for (const [v, d] of [
      ["5.3.0+1", "2026-11-01"],
      ["5.3.0+2", "2026-11-02"],
      ["5.3.0+3", "2026-11-03"],
    ] as const) {
      s.state.version = v;
      s.state.date = d;
      expect((await refreshCardData(base(s, dataDir))).status).toBe("updated");
    }
    expect(readdirSync(join(dataDir, "mtgjson")).sort()).toEqual([
      "5.3.0_2-2026-11-02",
      "5.3.0_3-2026-11-03",
      "current.json",
    ]);
    expect(readdirSync(join(dataDir, "derived")).sort()).toEqual([
      "5.3.0_2-2026-11-02.sqlite",
      "5.3.0_3-2026-11-03.sqlite",
    ]);
  });

  describe("failures keep the current version", () => {
    async function withCurrent() {
      const s = await serve();
      const dataDir = tempDir();
      const first = await refreshCardData(base(s, dataDir));
      s.state.version = "5.9.0+9";
      s.state.date = "2026-12-01";
      return { s, dataDir, first };
    }

    async function expectFailure(
      s: TestServer,
      dataDir: string,
      first: Awaited<ReturnType<typeof refreshCardData>>,
      errorKind: string,
      opts: { minCards?: number } = {},
    ): Promise<CardDataError> {
      const r = await refreshCardData({ ...base(s, dataDir), ...opts });
      expect(r.status).toBe("failed");
      expect(kind(r.error)).toBe(errorKind);
      expect(r.current).toEqual(first.current);
      expect(await readCurrent(dataDir)).toEqual(first.current);
      expect(readdirSync(join(dataDir, "tmp"))).toEqual([]);
      expect(readdirSync(join(dataDir, "mtgjson")).sort()).toEqual([
        "5.3.0_20261115-2026-11-15",
        "current.json",
      ]);
      return r.error!;
    }

    it("on a corrupt .gz", async () => {
      const { s, dataDir, first } = await withCurrent();
      const bad = Buffer.from(
        "this is definitely not gzip data, just text ".repeat(20),
      );
      s.state.gz = bad;
      s.state.gzSha = (await import("node:crypto"))
        .createHash("sha256")
        .update(bad)
        .digest("hex");
      await expectFailure(s, dataDir, first, "corrupt-archive");
    });

    it("on a truncated .gz", async () => {
      const { s, dataDir, first } = await withCurrent();
      s.state.gz = s.state.gz.subarray(0, 5000);
      await expectFailure(s, dataDir, first, "corrupt-archive");
    });

    it("on a .gz checksum mismatch", async () => {
      const { s, dataDir, first } = await withCurrent();
      s.state.gzSha = "f".repeat(64);
      const e = await expectFailure(s, dataDir, first, "corrupt-archive");
      expect(e.message).toMatch(/SHA-256/);
    });

    it("on an unpacked-file checksum mismatch", async () => {
      const { s, dataDir, first } = await withCurrent();
      s.state.rawSha = "e".repeat(64);
      const e = await expectFailure(s, dataDir, first, "corrupt-archive");
      expect(e.message).toMatch(/unpacked/);
    });

    it("on an archive that unpacks to nothing", async () => {
      const { s, dataDir, first } = await withCurrent();
      const empty = gzipSync(Buffer.alloc(0));
      const crypto = await import("node:crypto");
      s.state.gz = empty;
      s.state.gzSha = crypto.createHash("sha256").update(empty).digest("hex");
      s.state.rawSha = crypto.createHash("sha256").update("").digest("hex");
      await expectFailure(s, dataDir, first, "corrupt-archive");
    });

    it("on a failed self-check", async () => {
      const { s, dataDir, first } = await withCurrent();
      const e = await expectFailure(s, dataDir, first, "self-check", {
        minCards: 100000,
      });
      expect(e.message).toMatch(/only 116 distinct card names/);
      // The old version still opens.
      const opened = await openCurrent(dataDir);
      expect(opened.ok).toBe(true);
      if (opened.ok) opened.lookup.close();
    });

    it("on a file that is not a database", async () => {
      const { s, dataDir, first } = await withCurrent();
      const crypto = await import("node:crypto");
      const raw = Buffer.from("not a database ".repeat(1000));
      s.state.gz = gzipSync(raw);
      s.state.gzSha = crypto
        .createHash("sha256")
        .update(s.state.gz)
        .digest("hex");
      s.state.rawSha = crypto.createHash("sha256").update(raw).digest("hex");
      await expectFailure(s, dataDir, first, "self-check");
    });

    it("on an HTTP error", async () => {
      const { s, dataDir, first } = await withCurrent();
      s.state.status.set("/AllPrintings.sqlite.gz", 503);
      const e = await expectFailure(s, dataDir, first, "http-status");
      expect(e.status).toBe(503);
      s.state.status.clear();
      s.state.status.set("/Meta.json", 500);
      await expectFailure(s, dataDir, first, "http-status");
    });

    it("on a bad Meta.json or checksum file", async () => {
      const { s, dataDir, first } = await withCurrent();
      s.state.body.set("/Meta.json", "<html>maintenance</html>");
      await expectFailure(s, dataDir, first, "bad-meta");
      s.state.body.set("/Meta.json", '{"data": {"version": 5}}');
      await expectFailure(s, dataDir, first, "bad-meta");
      s.state.body.clear();
      s.state.body.set("/AllPrintings.sqlite.sha256", "nope");
      await expectFailure(s, dataDir, first, "bad-meta");
    });

    it("when the server is gone", async () => {
      const { s, dataDir, first } = await withCurrent();
      await s.close();
      await expectFailure(s, dataDir, first, "network");
    });

    it("when the server does not answer in time", async () => {
      const { s, dataDir, first } = await withCurrent();
      s.state.hang.add("/AllPrintings.sqlite.gz");
      const r = await refreshCardData({ ...base(s, dataDir), timeoutMs: 300 });
      expect(r.status).toBe("failed");
      expect(kind(r.error)).toBe("network");
      expect(r.current).toEqual(first.current);
    });

    it("when the derived build fails", async () => {
      const { s, dataDir, first } = await withCurrent();
      const r = await refreshCardData({
        ...base(s, dataDir),
        formatDefs: [{ key: "preset:x@1#000000000000", def: null }],
      });
      expect(r.status).toBe("failed");
      expect(kind(r.error)).toBe("build");
      expect(r.current).toEqual(first.current);
    });
  });

  it("reports a first-time failure with no current version", async () => {
    const s = await serve();
    s.state.status.set("/Meta.json", 500);
    const r = await refreshCardData(base(s, tempDir()));
    expect(r).toMatchObject({ status: "failed", current: null });
  });

  it("treats a damaged index as no data", async () => {
    const s = await serve();
    const dataDir = tempDir();
    await refreshCardData(base(s, dataDir));
    writeFileSync(join(dataDir, "mtgjson", "current.json"), "garbage");
    expect(await openCurrent(dataDir)).toEqual({
      ok: false,
      reason: "corrupt",
    });
    const r = await refreshCardData(base(s, dataDir));
    expect(r.status).toBe("updated");
    expect((await openCurrent(dataDir)).ok).toBe(true);
  });
});

describe("openCurrent", () => {
  it("reports no data on an empty data directory", async () => {
    expect(await openCurrent(tempDir())).toEqual({
      ok: false,
      reason: "no-data",
    });
  });

  it("marks a file with a wrong checksum corrupt, and the next refresh replaces it", async () => {
    const s = await serve();
    const dataDir = tempDir();
    const first = await refreshCardData(base(s, dataDir));
    const file = mtgjsonPath(dataDir, first.current!);
    const w = new Database(file);
    w.exec("UPDATE meta SET version = 'tampered'");
    w.close();

    expect(await openCurrent(dataDir)).toEqual({
      ok: false,
      reason: "corrupt",
    });
    expect((await readCurrent(dataDir))?.corrupt).toBe(true);
    // The flag alone is enough from now on, with no second checksum run.
    expect(await openCurrent(dataDir, { verifyChecksum: false })).toEqual({
      ok: false,
      reason: "corrupt",
    });

    // Meta.json shows the same version, but the corrupt file is replaced anyway.
    s.requests.length = 0;
    const r = await refreshCardData(base(s, dataDir));
    expect(r.status).toBe("updated");
    expect(r.current?.corrupt).toBeUndefined();
    expect(s.requests).toContain("/AllPrintings.sqlite.gz");
    const opened = await openCurrent(dataDir);
    expect(opened.ok).toBe(true);
    if (opened.ok) opened.lookup.close();
  });

  it("reports a missing file as corrupt, with or without the checksum run", async () => {
    const s = await serve();
    const dataDir = tempDir();
    const first = await refreshCardData(base(s, dataDir));
    rmSync(mtgjsonPath(dataDir, first.current!));
    expect(await openCurrent(dataDir, { verifyChecksum: false })).toEqual({
      ok: false,
      reason: "corrupt",
    });
    expect(await openCurrent(dataDir)).toEqual({
      ok: false,
      reason: "corrupt",
    });
  });

  it("rebuilds a missing derived file and builds requested formats", async () => {
    const s = await serve();
    const dataDir = tempDir();
    const first = await refreshCardData(base(s, dataDir));
    rmSync(derivedPath(dataDir, first.current!));
    const { preset } = await modernBuilds();
    const opened = await openCurrent(dataDir, {
      formatDefs: [preset],
      verifyChecksum: false,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(
      opened.lookup.inPool(
        preset.key,
        opened.lookup.findCard("Lightning Bolt")!,
      ),
    ).toBe(true);
    opened.lookup.close();
  });

  it("rebuilds a derived file of an older tool schema, so the new default takes effect", async () => {
    const s = await serve();
    const dataDir = tempDir();
    const first = await refreshCardData(base(s, dataDir));
    const { official } = await modernBuilds();
    const defaultOfPlains = async (): Promise<string> => {
      const opened = await openCurrent(dataDir, {
        formatDefs: [official],
        verifyChecksum: false,
      });
      if (!opened.ok) throw new Error("open failed");
      try {
        const p = opened.lookup.defaultPrinting(
          OFFICIAL_MODERN,
          opened.lookup.findCard("Plains")!,
        )!;
        return `${p.set}/${p.number}`;
      } finally {
        opened.lookup.close();
      }
    };
    expect(await defaultOfPlains()).toBe("UNH/136");

    // Make the derived file look like the previous release's: tool schema 1, and
    // the old default printing of Plains (the oldest non-funny one).
    const mtg = new Database(mtgjsonPath(dataDir, first.current!), {
      readonly: true,
    });
    const oldUuid = (
      mtg
        .prepare(
          "SELECT uuid FROM cards WHERE name = 'Plains' AND setCode = 'M15' LIMIT 1",
        )
        .get() as { uuid: string }
    ).uuid;
    mtg.close();
    const file = derivedPath(dataDir, first.current!);
    const old = new Database(file);
    old.prepare("UPDATE meta SET value = '1' WHERE key = 'tool_schema'").run();
    old
      .prepare("UPDATE default_printing SET uuid = ? WHERE name = 'Plains'")
      .run(oldUuid);
    old.close();

    // The same MTGJSON version is still current, and the upgrade needs no manual step.
    expect(await defaultOfPlains()).toBe("UNH/136");
    const again = new Database(file, { readonly: true });
    expect(
      (
        again
          .prepare("SELECT value FROM meta WHERE key = 'tool_schema'")
          .get() as { value: string }
      ).value,
    ).toBe(TOOL_SCHEMA);
    again.close();
  });

  it("reports a file that is not a database as corrupt", async () => {
    const s = await serve();
    const dataDir = tempDir();
    const first = await refreshCardData(base(s, dataDir));
    // Same bytes length is not needed: skip the checksum run to reach the open.
    writeFileSync(
      mtgjsonPath(dataDir, first.current!),
      "not a database ".repeat(2000),
    );
    rmSync(derivedPath(dataDir, first.current!));
    expect(await openCurrent(dataDir, { verifyChecksum: false })).toEqual({
      ok: false,
      reason: "corrupt",
    });
    expect((await readCurrent(dataDir))?.corrupt).toBe(true);
  });
});

describe("download", () => {
  it("reads Meta.json, with or without a trailing slash", async () => {
    const s = await serve("5.4.0+7", "2026-01-02");
    expect(await fetchMeta(s.url)).toEqual({
      version: "5.4.0+7",
      date: "2026-01-02",
    });
    expect(await fetchMeta(`${s.url}/`, { userAgent: "custom/1" })).toEqual({
      version: "5.4.0+7",
      date: "2026-01-02",
    });
    expect(s.headers.at(-1)?.["user-agent"]).toBe("custom/1");
  });

  it("accepts a checksum file in `<hash>  <name>` form, and leaves no partial file on failure", async () => {
    const s = await serve();
    s.state.body.set(
      "/AllPrintings.sqlite.sha256",
      `${s.state.rawSha.toUpperCase()}  AllPrintings.sqlite\n`,
    );
    const dir = tempDir();
    const ok = await downloadAllPrintings(s.url, join(dir, "a"));
    expect(ok.sha256).toBe(s.state.rawSha);
    expect(ok.bytes).toBe(fixtureArchive().raw.length);
    expect(ok.path.endsWith("AllPrintings.sqlite.partial")).toBe(true);

    s.state.rawSha = "0".repeat(64);
    s.state.body.clear();
    await expect(
      downloadAllPrintings(s.url, join(dir, "b")),
    ).rejects.toMatchObject({
      kind: "corrupt-archive",
    });
    expect(readdirSync(join(dir, "b"))).toEqual([]);
  });

  it("fails with a network error when the connection breaks mid-body", async () => {
    const http = await import("node:http");
    const { raw } = fixtureArchive();
    const srv = http.createServer((req, res) => {
      if (req.url?.endsWith(".sha256")) {
        res.writeHead(200).end("a".repeat(64));
        return;
      }
      res.writeHead(200, { "Content-Length": String(raw.length) });
      res.write(raw.subarray(0, 1000));
      setTimeout(() => res.destroy(), 20);
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as import("node:net").AddressInfo).port;
    try {
      await expect(
        downloadAllPrintings(`http://127.0.0.1:${port}`, join(tempDir(), "t")),
      ).rejects.toMatchObject({ kind: "network" });
    } finally {
      srv.closeAllConnections();
      srv.close();
    }
  });
});
