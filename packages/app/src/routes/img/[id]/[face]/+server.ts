import { readFile } from "node:fs/promises";
import { error } from "@sveltejs/kit";
import {
  getImageCache,
  getRateLimiter,
  requireSnapshot,
} from "#lib/server/app-state";
import { ImageError } from "#lib/server/image-cache";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, getClientAddress }) => {
  const snap = requireSnapshot();
  const { id, face } = params;
  if (face !== "front" && face !== "back") error(404, "Unknown face");
  const known = snap.allowedImages.get(id);
  if (known === undefined) error(404, "Unknown image");
  if (face === "back" && !known.hasBackFace)
    error(404, "This card has no back face");
  if (!getRateLimiter().take(getClientAddress())) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": "10" },
    });
  }
  try {
    const path = await getImageCache().get(id, face);
    return new Response(new Uint8Array(await readFile(path)), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=604800",
      },
    });
  } catch (e) {
    if (e instanceof ImageError) error(e.status === 404 ? 404 : 502, e.message);
    throw e;
  }
};
