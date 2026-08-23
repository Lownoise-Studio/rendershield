import fs from "fs-extra";
import path from "node:path";
import { loadConfig } from "../core/loadConfig.js";
import {
  checkPrerenderContract,
  type ContractCheckResult,
} from "../core/validateOutput.js";
import { renderShieldError } from "../errors.js";

function joinUrl(base: string, routePath: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return b + p;
}

async function findFirstIndexHtml(outDirAbs: string): Promise<string | null> {
  const stack: string[] = [outDirAbs];

  while (stack.length > 0) {
    const current = stack.pop() as string;

    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase() === "index.html") {
        // Ignore index.html at the output root; prefer a routed page like
        // <section>/<slug>/index.html (or deeper).
        const rel = path.relative(outDirAbs, full);
        const parts = rel.split(path.sep).filter(Boolean);
        if (parts.length >= 2) return full;
      }
    }
  }

  return null;
}

function indexHtmlPathToRoute(outDirAbs: string, indexPathAbs: string): string {
  const rel = path.relative(outDirAbs, indexPathAbs);
  // rel: <section>/<slug>/index.html
  const noFile = rel.replace(/index\.html$/i, "");
  const normalized = noFile.split(path.sep).join("/").replace(/\/+$/, "");
  return "/" + normalized.replace(/^\/+/, "");
}

const BOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const HUMAN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Heuristic: likely SPA shell if body has almost no visible content and no article. */
function looksLikeSpaShell(html: string): { likely: boolean; reason?: string } {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : html;
  const noScript = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const text = noScript.replace(/<\/?[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < 150) {
    return { likely: true, reason: `Body text very short (${text.length} chars); likely app shell.` };
  }
  if (!/<article\b/i.test(html)) {
    return { likely: true, reason: "No <article> present; may be SPA shell." };
  }
  const rootOnly = /<body[^>]*>\s*<div[^>]*id=["'](?:root|app|__next)["'][^>]*>\s*<\/div>\s*<\/body>/i.test(
    html.replace(/\s+/g, " ")
  );
  if (rootOnly) {
    return { likely: true, reason: "Single root div (e.g. #root, #app) with no content." };
  }
  return { likely: false };
}

export type VerifyProdOptions = { prodUrl: string };

export type VerifyLocalResult = {
  mode: "local";
  canonicalBase: string;
  routePath: string;
  outputFile: string;
  url: string;
};

export type VerifyProdResult = {
  mode: "prod";
  url: string;
  contract: ContractCheckResult;
};

export type VerifyResult = VerifyLocalResult | VerifyProdResult;

export async function cmdVerify(
  cwd = process.cwd(),
  options?: VerifyProdOptions
): Promise<VerifyResult> {
  if (options?.prodUrl) {
    return runVerifyProd(options.prodUrl);
  }

  const cfg = await loadConfig(cwd);

  const outDirAbs = path.join(cwd, cfg.output.outDir);
  const exists = await fs.pathExists(outDirAbs);

  if (!exists) {
    throw renderShieldError(
      "VERIFY_FAILED",
      `No prerender output directory found: ${cfg.output.outDir}/. Run: rendershield build`,
      { outDir: cfg.output.outDir }
    );
  }

  const firstIndex = await findFirstIndexHtml(outDirAbs);

  if (!firstIndex) {
    throw renderShieldError(
      "VERIFY_FAILED",
      `No prerendered pages found inside: ${cfg.output.outDir}/. Run: rendershield build`,
      { outDir: cfg.output.outDir }
    );
  }

  const routePath = indexHtmlPathToRoute(outDirAbs, firstIndex);
  const url = joinUrl(cfg.site.canonicalBase, routePath);
  const outputFile = path.relative(cwd, firstIndex);

  console.log(`
RenderShield verify

Using:
  canonicalBase: ${cfg.site.canonicalBase}
  routePath:     ${routePath}
  output file:   ${outputFile}

Smoke tests:

1) Human (usually SPA shell):
  curl -s ${url} | grep -i "<title>"

2) Bot (should see prerendered, route-specific title):
  curl -s -H "User-Agent: Googlebot" ${url} | grep -i "<title>"

3) Debug headers (Worker must be routed + proxy ON):
  curl -I -H "User-Agent: GPTBot" ${url}

Expected: x-rendershield: bot-hit (proves Worker served prerender to bot).
If debugHeaders enabled: X-Bot-Detected, X-Prerender, X-Final-Path.
`);

  return {
    mode: "local",
    canonicalBase: cfg.site.canonicalBase,
    routePath,
    outputFile,
    url,
  };
}

async function runVerifyProd(url: string): Promise<VerifyProdResult> {
  const normalizedUrl = url.startsWith("http") ? url : `https://${url}`;

  let botHtml: string;
  let humanHtml: string;
  let botStatus: number;
  let humanStatus: number;
  let xRenderShield: string | null;

  try {
    const [botRes, humanRes] = await Promise.all([
      fetch(normalizedUrl, {
        headers: { "User-Agent": BOT_UA },
        redirect: "follow",
      }),
      fetch(normalizedUrl, {
        headers: { "User-Agent": HUMAN_UA },
        redirect: "follow",
      }),
    ]);

    botStatus = botRes.status;
    humanStatus = humanRes.status;
    xRenderShield = botRes.headers.get("x-rendershield");
    botHtml = await botRes.text();
    humanHtml = await humanRes.text();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw renderShieldError(
      "VERIFY_FAILED",
      `verify --prod: failed to fetch ${normalizedUrl}. ${msg}`,
      { url: normalizedUrl }
    );
  }

  // Prove routing: Worker must set x-rendershield: bot-hit for bot requests. No inference.
  const routingOk = xRenderShield === "bot-hit";
  if (xRenderShield === "bot-fallback") {
    throw renderShieldError(
      "VERIFY_FAILED",
      `verify --prod: bot request received x-rendershield: bot-fallback. ` +
        `Prerender origin returned non-200; Worker fell back to SPA. Fix deployment or origin so bots get prerendered HTML.`,
      { url: normalizedUrl, xRenderShield }
    );
  }
  if (!routingOk) {
    const hint = xRenderShield == null
      ? " If no Worker is deployed, use verify without --prod to check local/build output."
      : "";
    throw renderShieldError(
      "VERIFY_FAILED",
      `verify --prod: expected x-rendershield: bot-hit (proving Worker routed bot to prerender). ` +
        `Got: ${xRenderShield ?? "(missing)"}. Ensure the Worker is deployed and bound to this route.${hint}`,
      { url: normalizedUrl, xRenderShield }
    );
  }

  const contract = checkPrerenderContract(botHtml, {
    routePath: normalizedUrl,
    outFile: normalizedUrl,
  });

  const humanSpa = looksLikeSpaShell(humanHtml);

  // Report
  console.log(`
RenderShield verify --prod
URL: ${normalizedUrl}

Fetch:
  Bot (Googlebot):   ${botStatus}  (${botHtml.length} bytes)  x-rendershield: ${xRenderShield ?? "(none)"}
  Human (Chrome):    ${humanStatus}  (${humanHtml.length} bytes)

Routing:  x-rendershield: bot-hit (Worker served prerendered HTML to bot)

Bot contract (title, meta, canonical, OG, JSON-LD, article):
  ${contract.ok ? "PASS — all required fields present." : "FAIL — missing or invalid:"}
${contract.missing.length > 0 ? contract.missing.map((m) => `  - ${m}`).join("\n") : ""}

Human response:
  ${humanSpa.likely ? `Likely SPA shell: ${humanSpa.reason ?? "unknown"}` : "Has substantial content (not a minimal SPA shell)."}
`);

  if (!contract.ok) {
    throw renderShieldError(
      "VERIFY_FAILED",
      `Production URL did not satisfy bot contract. Missing: ${contract.missing.join("; ")}`,
      { url: normalizedUrl, missing: contract.missing }
    );
  }

  return { mode: "prod", url: normalizedUrl, contract };
}
