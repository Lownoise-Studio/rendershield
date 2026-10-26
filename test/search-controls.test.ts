import { describe, it, expect } from "vitest";
import { parseMarkdownFromRaw } from "../dist/core/markdownContent.js";
import { renderPageHtml } from "../dist/core/renderHtml.js";
import { assertSearchControls } from "../dist/core/searchControls.js";
import { parseVerifyArgs } from "../dist/cliArgs.js";
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync("rendershield.config.json", "utf8"));
const source = (extra = "") => `---\ntitle: Controls\nexcerpt: Description\ndatePublished: "2026-10-26"\ncoverImage: /image.jpg\nslug: test-page\n${extra}---\nHello **reader**.\n<script>alert(1)</script>`;
const doc = (extra = "") => parseMarkdownFromRaw(source(extra), "test.md", "blog", "/blog");
describe("search controls", () => {
  it("renders controls through the real Markdown parser without enabling raw HTML", () => {
    const html = renderPageHtml(cfg, doc('robots: "noindex, nosnippet"\nnoSnippet: true\n'));
    assertSearchControls(html, new Headers(), { expectRobots: "NOSNIPPET, noindex", expectNoSnippet: true });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("<strong>reader</strong>");
  });
  it("leaves controls absent by default and rejects invalid types", () => {
    expect(renderPageHtml(cfg, doc())).not.toContain("data-nosnippet");
    for (const extra of ['robots: false\n', 'robots: ""\n', 'noSnippet: "true"\n']) expect(() => doc(extra)).toThrow();
  });
  it("escapes meta values", () => {
    expect(renderPageHtml(cfg, doc(`robots: 'noindex" onload="bad'\n`))).toContain("&quot;");
  });
  it("rejects missing or mismatched controls and ignores text, comments and scripts", () => {
    for (const html of ['&lt;div data-nosnippet&gt;', '<!-- <div data-nosnippet> -->', '<script>"<div data-nosnippet>"</script>']) expect(() => assertSearchControls(html, new Headers(), {expectNoSnippet:true})).toThrow();
    expect(() => assertSearchControls('<meta name="robots" content="index">', new Headers(), {expectRobots:'noindex'})).toThrow();
    expect(() => assertSearchControls('', new Headers(), {expectXRobotsTag:'noindex'})).toThrow();
    assertSearchControls('', new Headers({'X-Robots-Tag':'nosnippet, noindex'}), {expectXRobotsTag:'noindex,nosnippet'});
  });
  it("parses explicit verification flags and rejects missing values", () => {
    expect(parseVerifyArgs(['--prod','https://example.com','--expect-robots','noindex','--expect-x-robots-tag','nosnippet','--expect-nosnippet'],{})).toMatchObject({expectRobots:'noindex',expectXRobotsTag:'nosnippet',expectNoSnippet:true});
    expect(() => parseVerifyArgs(['--expect-robots'],{})).toThrow();
  });
});
