/**
 * What went wrong in a download or refresh.
 *
 * - `network`: the request failed, timed out, or the body stream broke.
 * - `http-status`: the server answered with a status that is not 200.
 * - `corrupt-archive`: the archive did not unpack, or a checksum did not match.
 * - `bad-meta`: `Meta.json` or a `.sha256` file has an unexpected shape.
 * - `self-check`: the MTGJSON file failed the self-check.
 * - `build`: building the derived file or installing the files failed.
 */
export type CardDataErrorKind =
  | "network"
  | "http-status"
  | "corrupt-archive"
  | "bad-meta"
  | "self-check"
  | "build";

export class CardDataError extends Error {
  constructor(
    readonly kind: CardDataErrorKind,
    message: string,
    options?: { cause?: unknown; status?: number; url?: string },
  ) {
    super(
      message,
      options?.cause === undefined ? {} : { cause: options.cause },
    );
    this.name = "CardDataError";
    this.status = options?.status;
    this.url = options?.url;
  }
  /** The HTTP status, for `http-status`. */
  readonly status: number | undefined;
  readonly url: string | undefined;
}
