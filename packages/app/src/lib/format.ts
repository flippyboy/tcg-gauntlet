// Formatting that must give the same text on the server and in the browser, so it
// never uses the visitor's locale or time zone.

/** `2026-11-16 02:50 UTC` for an ISO timestamp. Other text is returned as it came. */
export function formatUtc(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** `2026-11-16` for an ISO timestamp. */
export function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toISOString().slice(0, 10);
}
