import { createRequire } from "node:module";
import { RenderShieldConfig } from "../types.js";

const require = createRequire(import.meta.url);
let VERSION = "0.0.0";
try {
  const pkg = require("../../package.json") as { version?: string };
  VERSION = pkg.version ?? "0.0.0";
} catch {
  VERSION = "unknown";
}

function jsStringArray(arr: string[]): string {
  return `[${arr.map((s) => JSON.stringify(s)).join(", ")}]`;
}

export function generateWorkerJs(cfg: RenderShieldConfig): string {
  const patterns = cfg.worker.botUserAgentPatterns.map((p) => p.toLowerCase());
  const rewriteBases = cfg.worker.rewriteRouteBases;

  return `/**
 * RenderShield Worker (generated) v${VERSION}
 * Serves prerendered /index.html to bots on selected route bases.
 */

const BOT_SUBSTRINGS = ${jsStringArray(patterns)};
const REWRITE_BASES = ${jsStringArray(rewriteBases)};

function isBot(ua) {
  const s = (ua || "").toLowerCase();
  return BOT_SUBSTRINGS.some((sub) => s.includes(sub));
}

function shouldRewrite(pathname) {
  return REWRITE_BASES.some((base) => pathname.startsWith(base));
}

function toIndexHtml(pathname) {
  let p = pathname;
  if (!p.endsWith("/")) p += "/";
  return p + "index.html";
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ua = request.headers.get("User-Agent") || "";
    const bot = isBot(ua);

    const isGetLike = request.method === "GET" || request.method === "HEAD";
    const rewrite = bot && isGetLike && shouldRewrite(url.pathname);

    try {
      if (!rewrite) {
        const passResp = await fetch(request);
        const out = new Response(passResp.body, passResp);
        out.headers.set("x-rendershield", "pass-through");
        return out;
      }

      const origin = ${JSON.stringify(cfg.worker.spaOrigin)};
      const finalPath = toIndexHtml(url.pathname);
      const originUrl = origin + finalPath + url.search;

      const headers = new Headers();
      headers.set("Accept", "text/html");
      headers.set("User-Agent", ua);

      const resp = await fetch(originUrl, { method: "GET", headers });

      if (!resp.ok) {
        const fallbackUrl = origin + url.pathname + url.search;
        const fb = await fetch(fallbackUrl, { method: "GET", headers });
        const out = new Response(fb.body, fb);
        out.headers.set("x-rendershield", "bot-fallback");
        ${cfg.worker.debugHeaders ? `out.headers.set("X-Bot-Detected", "true");
        out.headers.set("X-Prerender-Fallback", "true");
        out.headers.set("X-Requested-Path", url.pathname);` : ""}
        return out;
      }

      const out = new Response(resp.body, resp);
      out.headers.set("x-rendershield", "bot-hit");
      ${cfg.worker.debugHeaders ? `out.headers.set("X-Bot-Detected", "true");
      out.headers.set("X-Prerender", "true");
      out.headers.set("X-Final-Path", finalPath);` : ""}
      return out;
    } catch (err) {
      return new Response("Service temporarily unavailable.", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  }
};
`;
}
