// Structured logs: one JSON object per line on stdout.
import type { LogLevel } from "./config.js";

export interface LogFields {
  commit?: string;
  path?: string;
  durationMs?: number;
  err?: unknown;
  [key: string]: unknown;
}

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let threshold: LogLevel = "info";
let sink: (line: string) => void = (line) => {
  process.stdout.write(`${line}\n`);
};

export function setLogLevel(level: LogLevel): void {
  threshold = level;
}

/** For tests: replaces where lines go. Returns a function that restores stdout. */
export function setLogSink(fn: (line: string) => void): () => void {
  sink = fn;
  return () => {
    sink = (line) => {
      process.stdout.write(`${line}\n`);
    };
  };
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}

export function log(
  level: LogLevel,
  msg: string,
  fields: LogFields = {},
): void {
  if (ORDER[level] < ORDER[threshold]) return;
  const { err, ...rest } = fields;
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...rest,
  };
  if (err !== undefined) line["err"] = errText(err);
  sink(JSON.stringify(line));
}

export const logger = {
  debug: (msg: string, f?: LogFields): void => log("debug", msg, f),
  info: (msg: string, f?: LogFields): void => log("info", msg, f),
  warn: (msg: string, f?: LogFields): void => log("warn", msg, f),
  error: (msg: string, f?: LogFields): void => log("error", msg, f),
};
