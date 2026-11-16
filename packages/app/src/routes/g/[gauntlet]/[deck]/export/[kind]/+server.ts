import { error } from "@sveltejs/kit";
import { requireDeck } from "#lib/server/app-state";
import { contentDisposition, safeFileName } from "#lib/server/views";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ params }) => {
  const { d } = requireDeck(params.gauntlet, params.deck);
  let text: string;
  let ext: string;
  if (params.kind === "mtgo") {
    text = d.exports.mtgo;
    ext = "txt";
  } else if (params.kind === "dec") {
    text = d.exports.dec;
    ext = "dec";
  } else {
    error(404, "Unknown export");
  }
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": contentDisposition(
        `${safeFileName(d.name)}.${ext}`,
      ),
    },
  });
};
