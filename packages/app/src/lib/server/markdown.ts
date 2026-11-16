// Markdown for primers and gauntlet descriptions: raw HTML off, links limited to
// http(s), mailto and anchors, no images, external links with rel="noopener nofollow".
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: true });

const SAFE = /^(https?:|mailto:|#)/i;
md.validateLink = (url: string): boolean => SAFE.test(url.trim());

// Images inside primers are not allowed: the tokens are removed.
md.core.ruler.push("strip_images", (state) => {
  for (const block of state.tokens) {
    if (block.type !== "inline" || block.children === null) continue;
    const kept = [];
    for (const t of block.children) if (t.type !== "image") kept.push(t);
    block.children = kept;
  }
  return true;
});

// External links get rel and no target.
md.core.ruler.push("external_rel", (state) => {
  for (const block of state.tokens) {
    if (block.type !== "inline" || block.children === null) continue;
    for (const t of block.children) {
      if (t.type !== "link_open") continue;
      const href = String(t.attrGet("href") ?? "");
      if (!href.startsWith("#")) t.attrSet("rel", "noopener nofollow");
    }
  }
  return true;
});

/** Renders untrusted Markdown to HTML. */
export function renderMarkdown(text: string): string {
  return md.render(text);
}
