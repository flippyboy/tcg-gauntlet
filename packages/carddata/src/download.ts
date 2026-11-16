// Network I/O: Meta.json and the AllPrintings archive.
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { ENGINE_VERSION } from "@tcg-gauntlet/engine";
import { CardDataError } from "./errors.js";

/** The longest a single request, including streaming its body, may take. */
export const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export interface RequestOptions {
  /** Default `tcg-gauntlet/<version>`. */
  userAgent?: string;
  /** Default 10 minutes. */
  timeoutMs?: number;
}

export interface MetaInfo {
  version: string;
  date: string;
}

export interface Downloaded {
  /** The unpacked file, `<tmpDir>/AllPrintings.sqlite.partial`. */
  path: string;
  /** SHA-256 of the unpacked file, lower-case hex. */
  sha256: string;
  bytes: number;
}

const defaultUserAgent = (): string => `tcg-gauntlet/${ENGINE_VERSION}`;

const url = (baseUrl: string, file: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/${file}`;

async function get(
  target: string,
  opts: RequestOptions,
): Promise<{ res: Response; signal: AbortSignal }> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(target, {
      headers: { "User-Agent": opts.userAgent ?? defaultUserAgent() },
      signal,
    });
  } catch (e) {
    throw new CardDataError("network", `GET ${target} failed: ${describe(e)}`, {
      cause: e,
      url: target,
    });
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => undefined);
    throw new CardDataError(
      "http-status",
      `GET ${target} returned HTTP ${res.status}`,
      { status: res.status, url: target },
    );
  }
  return { res, signal };
}

function describe(e: unknown): string {
  if (e instanceof Error) {
    const cause = e.cause instanceof Error ? ` (${e.cause.message})` : "";
    return `${e.name}: ${e.message}${cause}`;
  }
  return String(e);
}

async function getText(target: string, opts: RequestOptions): Promise<string> {
  const { res } = await get(target, opts);
  try {
    return await res.text();
  } catch (e) {
    throw new CardDataError(
      "network",
      `reading ${target} failed: ${describe(e)}`,
      { cause: e, url: target },
    );
  }
}

/**
 * Reads `Meta.json`, shaped `{meta: {date, version}, data: {date, version}}`. The
 * `data` block is the one that describes the card data. MTGJSON's server may cache
 * the file for up to 16 hours, so a newer build can show up late.
 */
export async function fetchMeta(
  baseUrl: string,
  opts: RequestOptions = {},
): Promise<MetaInfo> {
  const target = url(baseUrl, "Meta.json");
  const text = await getText(target, opts);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new CardDataError("bad-meta", `${target} is not JSON`, {
      cause: e,
      url: target,
    });
  }
  const data = (
    parsed as { data?: { version?: unknown; date?: unknown } } | null
  )?.data;
  if (
    typeof data?.version !== "string" ||
    data.version === "" ||
    typeof data.date !== "string" ||
    data.date === ""
  ) {
    throw new CardDataError(
      "bad-meta",
      `${target} has no data.version and data.date`,
      { url: target },
    );
  }
  return { version: data.version, date: data.date };
}

/** A `.sha256` file holds a bare 64-character hex value. A `<hash>  <name>` line is accepted. */
async function fetchChecksum(
  target: string,
  opts: RequestOptions,
): Promise<string> {
  const text = await getText(target, opts);
  const m = /^\s*([0-9a-fA-F]{64})(?:\s|$)/.exec(text);
  if (m?.[1] === undefined) {
    throw new CardDataError("bad-meta", `${target} is not a SHA-256 value`, {
      url: target,
    });
  }
  return m[1].toLowerCase();
}

/** A pass-through stream that hashes what flows through it. */
function hasher(): {
  stream: Transform;
  digest: () => string;
  bytes: () => number;
} {
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      bytes += chunk.length;
      cb(null, chunk);
    },
  });
  return { stream, digest: () => hash.digest("hex"), bytes: () => bytes };
}

const isZlibError = (e: unknown): boolean =>
  typeof (e as { code?: unknown } | null)?.code === "string" &&
  ((e as { code: string }).code.startsWith("Z_") ||
    (e as { code: string }).code === "ERR_BUFFER_TOO_LARGE");

/**
 * Downloads `AllPrintings.sqlite.gz` and unpacks it to
 * `<tmpDir>/AllPrintings.sqlite.partial`, hashing both the archive and the unpacked
 * file on the way. `tmpDir` is inside the data directory, so that the later rename
 * stays on one filesystem. Both `.sha256` files are fetched and checked. Any failure
 * removes the partial file.
 */
export async function downloadAllPrintings(
  baseUrl: string,
  tmpDir: string,
  opts: RequestOptions = {},
): Promise<Downloaded> {
  await mkdir(tmpDir, { recursive: true });
  const partial = join(tmpDir, "AllPrintings.sqlite.partial");
  try {
    const [gzSum, rawSum] = [
      await fetchChecksum(url(baseUrl, "AllPrintings.sqlite.gz.sha256"), opts),
      await fetchChecksum(url(baseUrl, "AllPrintings.sqlite.sha256"), opts),
    ];
    const target = url(baseUrl, "AllPrintings.sqlite.gz");
    const { res } = await get(target, opts);
    if (res.body === null) {
      throw new CardDataError("network", `GET ${target} has no body`, {
        url: target,
      });
    }
    const packed = hasher();
    const unpacked = hasher();
    const source = Readable.fromWeb(res.body);
    let sourceError: unknown;
    source.on("error", (e) => {
      sourceError ??= e;
    });
    try {
      await pipeline(
        source,
        packed.stream,
        createGunzip(),
        unpacked.stream,
        createWriteStream(partial),
      );
    } catch (e) {
      if (e instanceof CardDataError) throw e;
      // A broken connection can also surface as a truncated archive. The source's own
      // error says which it was.
      throw sourceError === undefined && isZlibError(e)
        ? new CardDataError(
            "corrupt-archive",
            `${target} did not unpack: ${describe(e)}`,
            { cause: e, url: target },
          )
        : new CardDataError(
            "network",
            `downloading ${target} failed: ${describe(e)}`,
            { cause: e, url: target },
          );
    }
    const gzActual = packed.digest();
    if (gzActual !== gzSum) {
      throw new CardDataError(
        "corrupt-archive",
        `${target}: SHA-256 is ${gzActual}, expected ${gzSum}`,
        { url: target },
      );
    }
    const rawActual = unpacked.digest();
    if (rawActual !== rawSum) {
      throw new CardDataError(
        "corrupt-archive",
        `unpacked AllPrintings.sqlite: SHA-256 is ${rawActual}, expected ${rawSum}`,
        { url: target },
      );
    }
    if (unpacked.bytes() === 0) {
      throw new CardDataError(
        "corrupt-archive",
        `${target} unpacked to nothing`,
        {
          url: target,
        },
      );
    }
    const fh = await open(partial, "r+");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    return { path: partial, sha256: rawActual, bytes: unpacked.bytes() };
  } catch (e) {
    await rm(partial, { force: true });
    throw e;
  }
}
