import { describe, it, expect, vi, afterEach } from "vitest";
import { cmdVerify } from "../dist/commands/verify.js";
import { isRenderShieldError } from "../dist/errors.js";

const validBotHtml = `<!DOCTYPE html><html><head><title>Test</title>
<meta name="description" content="Desc">
<link rel="canonical" href="https://example.com/">
<meta property="og:title" content="Test">
<meta property="og:description" content="Desc">
<meta property="og:image" content="https://example.com/img.jpg">
<meta property="og:url" content="https://example.com/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Test","datePublished":"2024-01-15"}</script>
</head><body><article><p>This is enough article content to pass the word and character count requirements for the contract check.</p></article></body></html>`;

const spaShellHtml = `<!DOCTYPE html><html><head><title>App</title></head><body><div id="root"></div></body></html>`;

function mockFetch(handlers: {
  bot?: { status?: number; headers?: Record<string, string>; body?: string };
  human?: { status?: number; headers?: Record<string, string>; body?: string };
}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const ua = String(
      (init?.headers as Record<string, string> | undefined)?.["User-Agent"] ?? ""
    );
    const isBot = ua.toLowerCase().includes("googlebot");
    const spec = isBot ? handlers.bot : handlers.human;
    const status = spec?.status ?? 200;
    const body = spec?.body ?? (isBot ? validBotHtml : spaShellHtml);
    const headers = new Headers(spec?.headers ?? {});

    return {
      status,
      headers,
      text: async () => body,
    } as Response;
  });
}

describe("cmdVerify --prod", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns prod result when routing and contract pass", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        bot: { headers: { "x-rendershield": "bot-hit" }, body: validBotHtml },
        human: { body: spaShellHtml },
      })
    );

    const result = await cmdVerify(process.cwd(), {
      prodUrl: "https://example.com/blog/post",
    });

    expect(result.mode).toBe("prod");
    if (result.mode === "prod") {
      expect(result.url).toBe("https://example.com/blog/post");
      expect(result.contract.ok).toBe(true);
    }
  });

  it("throws VERIFY_FAILED when x-rendershield header is missing", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        bot: { headers: {}, body: validBotHtml },
        human: { body: spaShellHtml },
      })
    );

    await expect(
      cmdVerify(process.cwd(), { prodUrl: "https://example.com" })
    ).rejects.toSatisfy((err: unknown) => {
      return isRenderShieldError(err) && err.code === "VERIFY_FAILED";
    });
  });

  it("throws VERIFY_FAILED on bot-fallback header", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        bot: { headers: { "x-rendershield": "bot-fallback" }, body: validBotHtml },
        human: { body: spaShellHtml },
      })
    );

    await expect(
      cmdVerify(process.cwd(), { prodUrl: "https://example.com" })
    ).rejects.toSatisfy((err: unknown) => {
      return (
        isRenderShieldError(err) &&
        err.code === "VERIFY_FAILED" &&
        err.message.includes("bot-fallback")
      );
    });
  });

  it("throws VERIFY_FAILED when bot HTML fails contract", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        bot: {
          headers: { "x-rendershield": "bot-hit" },
          body: "<html><body>incomplete</body></html>",
        },
        human: { body: spaShellHtml },
      })
    );

    await expect(
      cmdVerify(process.cwd(), { prodUrl: "https://example.com" })
    ).rejects.toSatisfy((err: unknown) => {
      return isRenderShieldError(err) && err.code === "VERIFY_FAILED";
    });
  });
});
