import { describe, it, expect } from "vitest";
import { checkPrerenderContract } from "../dist/core/validateOutput.js";

const baseHtml = (fragment: string) =>
  `<!DOCTYPE html><html><head><title>Test</title>
<meta name="description" content="Desc">
<link rel="canonical" href="https://example.com/">
<meta property="og:title" content="Test">
<meta property="og:description" content="Desc">
<meta property="og:image" content="https://example.com/img.jpg">
<meta property="og:url" content="https://example.com/">
${fragment}
</head><body><article><p>This is enough article content to pass the word and character count requirements for the contract check.</p></article></body></html>`;

describe("checkPrerenderContract", () => {
  it("passes when all required fields and valid JSON-LD are present", () => {
    const jsonLd = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Test","datePublished":"2024-01-15"}</script>`;
    const html = baseHtml(jsonLd);
    const result = checkPrerenderContract(html);
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("fails when title is missing", () => {
    const html = baseHtml("").replace("<title>Test</title>", "<title></title>");
    const result = checkPrerenderContract(html);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.includes("title"))).toBe(true);
  });

  it("fails when meta description is missing", () => {
    const html = baseHtml("").replace(
      '<meta name="description" content="Desc">',
      ""
    );
    const result = checkPrerenderContract(html);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.includes("description"))).toBe(true);
  });

  it("fails when canonical is missing", () => {
    const html = baseHtml("").replace(
      '<link rel="canonical" href="https://example.com/">',
      ""
    );
    const result = checkPrerenderContract(html);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.includes("canonical"))).toBe(true);
  });

  it("fails when Open Graph tags are missing", () => {
    const html = baseHtml("").replace(
      /<meta property="og:[^>]+>/g,
      ""
    );
    const result = checkPrerenderContract(html);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.includes("Open Graph"))).toBe(true);
  });

  it("fails when JSON-LD script is missing", () => {
    const html = baseHtml("");
    const result = checkPrerenderContract(html);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.includes("JSON-LD"))).toBe(true);
  });

  it("fails when JSON-LD @type is not in allowed list", () => {
    const jsonLd = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","name":"X"}</script>`;
    const html = baseHtml(jsonLd);
    const result = checkPrerenderContract(html);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.includes("type contract") || m.includes("JSON-LD"))).toBe(true);
  });

  it("passes when JSON-LD is WebPage (allowed type)", () => {
    const jsonLd = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"Test Page"}</script>`;
    const html = baseHtml(jsonLd);
    const result = checkPrerenderContract(html);
    expect(result.ok).toBe(true);
  });

  it("fails when article is missing", () => {
    const jsonLd = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Test","datePublished":"2024-01-15"}</script>`;
    const html = baseHtml(jsonLd).replace(/<article>[\s\S]*?<\/article>/i, "");
    const result = checkPrerenderContract(html);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.includes("article"))).toBe(true);
  });

  it("fails when article content is too short", () => {
    const jsonLd = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Test","datePublished":"2024-01-15"}</script>`;
    const short = baseHtml(jsonLd).replace(
      /<article>[\s\S]*?<\/article>/i,
      "<article><p>Short.</p></article>"
    );
    const result = checkPrerenderContract(short);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.includes("short"))).toBe(true);
  });

  it("respects allowedJsonLdTypes option", () => {
    const jsonLd = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","name":"FAQ"}</script>`;
    const html = baseHtml(jsonLd);
    const without = checkPrerenderContract(html);
    expect(without.ok).toBe(false);
    const withAllowed = checkPrerenderContract(html, {
      allowedJsonLdTypes: ["Article", "BlogPosting", "WebPage", "FAQPage"],
    });
    expect(withAllowed.ok).toBe(true);
  });
});
