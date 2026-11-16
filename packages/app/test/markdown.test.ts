import { describe, expect, it } from "vitest";
import { githubLinks } from "../src/lib/server/github-links.js";
import { renderMarkdown } from "../src/lib/server/markdown.js";

describe("markdown", () => {
  it("escapes raw HTML", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("drops javascript: links", () => {
    const html = renderMarkdown(
      "[x](javascript:alert(1)) and [d](data:text/html;base64,AAAA)",
    );
    expect(html).not.toContain("href");
  });

  it("removes images", () => {
    const html = renderMarkdown("![alt](https://example.com/a.png) text");
    expect(html).not.toContain("<img");
    expect(html).toContain("text");
  });

  it("keeps anchors, mailto and http links, with rel on external ones", () => {
    const html = renderMarkdown(
      "[a](#top) [m](mailto:a@b.c) [e](https://example.com/x)",
    );
    expect(html).toContain('<a href="#top">');
    expect(html).toContain('href="mailto:a@b.c"');
    expect(html).toMatch(
      /<a href="https:\/\/example.com\/x" rel="noopener nofollow">/,
    );
    expect(html).not.toContain("target");
  });

  it("links bare URLs", () => {
    expect(renderMarkdown("see https://example.com/y")).toContain(
      'rel="noopener nofollow"',
    );
  });
});

describe("github links", () => {
  const l = githubLinks({
    repoWebUrl: "https://github.com/o/r",
    branch: "feat/x",
  });
  it("builds edit, new, commit and blob URLs", () => {
    expect(l.edit("my gauntlet/déck.txt")).toBe(
      "https://github.com/o/r/edit/feat/x/my%20gauntlet/d%C3%A9ck.txt",
    );
    expect(l.newFile("g")).toBe("https://github.com/o/r/new/feat/x/g");
    expect(l.commit("abc")).toBe("https://github.com/o/r/commit/abc");
    expect(l.blob("g/a.txt")).toBe(
      "https://github.com/o/r/blob/feat/x/g/a.txt",
    );
  });
  it("uses the configured URL as the base in test mode", () => {
    const t = githubLinks({ repoWebUrl: "file:///tmp/repo", branch: "main" });
    expect(t.edit("g/a.txt")).toBe("file:///tmp/repo/edit/main/g/a.txt");
  });
});
