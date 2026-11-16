import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () =>
  new Response("ok\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
