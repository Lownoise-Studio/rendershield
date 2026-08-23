import fs from "fs-extra";
import path from "node:path";
import { loadConfig } from "../core/loadConfig.js";
import {
  listPrerenderIndexFiles,
  indexHtmlPathToRoute,
} from "../core/listOutputRoutes.js";
import {
  checkPrerenderContract,
  type ContractCheckResult,
} from "../core/validateOutput.js";
import { renderShieldError } from "../errors.js";
import type { CommandOptions } from "../configPath.js";

function joinUrl(base: string, routePath: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return b + p;
}

const BOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const HUMAN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

export type VerifyPageResult = {
  routePath: string;
  outputFile: string;
  url: string;
  contract?: ContractCheckResult;
};

export type VerifyOptions = CommandOptions & {
  /** Set when --prod is passed (URL may be omitted with --all). */
  prod?: boolean;
  prodUrl?: string;
  check?: boolean;
  all?: boolean;
};

export type VerifyLocalResult = {
  mode: "local";
  canonicalBase: string;
  checked: boolean;
  ok: boolean;
  pages: VerifyPageResult[];
};

export type VerifyProdResult = {
  mode: "prod";
  ok: boolean;
  pages: Array<{ url: string; contract: ContractCheckResult }>;
};

export type VerifyResult = VerifyLocalResult | VerifyProdResult;

export async function cmdVerify(
  cwd = process.cwd(),
  options: VerifyOptions = {}
): Promise<VerifyResult> {
  if (options.prod || options.prodUrl) {
    return runVerifyProdMode(cwd, options);
  }

  if (options.check) {
    return runLocalCheckMode(cwd, options);
  }

  if (options.all) {
    throw renderShieldError(
      "CLI_INVALID_ARGS",
      "verify --all requires --check (local) or --prod (production). Example: rendershield verify --all --check"
    );
  }

  return runLocalSmoke(cwd, options);
}

async function runVerifyProdMode(
  cwd: string,
  options: VerifyOptions
): Promise<VerifyProdResult> {
  const cfg = await loadConfig(cwd, options);
  const outDirAbs = path.join(cwd, cfg.output.outDir);

  if (options.all) {
    await assertOutputExists(outDirAbs, cfg.output.outDir);
    const indexFiles = await listPrerenderIndexFiles(outDirAbs);
    if (indexFiles.length === 0) {
      throw renderShieldError(
        "VERIFY_FAILED",
        `No prerendered pages found inside: ${cfg.output.outDir}/. Run: rendershield build`,
        { outDir: cfg.output.outDir }
      );
    }
    return runVerifyProdAll(cfg, cwd, outDirAbs, indexFiles);
  }

  if (!options.prodUrl) {
    throw renderShieldError(
      "CLI_INVALID_ARGS",
      "verify --prod requires a URL, or use --prod --all to check every route from build output."
    );
  }

  const single = await fetchAndVerifyProd(
    options.prodUrl.startsWith("http") ? options.prodUrl : `https://${options.prodUrl}`
  );
  return { mode: "prod", ok: true, pages: [single] };
}

async function runLocalCheckMode(
  cwd: string,
  options: VerifyOptions
): Promise<VerifyLocalResult> {
  const cfg = await loadConfig(cwd, options);
  const outDirAbs = path.join(cwd, cfg.output.outDir);
  await assertOutputExists(outDirAbs, cfg.output.outDir);

  const indexFiles = await listPrerenderIndexFiles(outDirAbs);
  if (indexFiles.length === 0) {
    throw renderShieldError(
      "VERIFY_FAILED",
      `No prerendered pages found inside: ${cfg.output.outDir}/. Run: rendershield build`,
      { outDir: cfg.output.outDir }
    );
  }

  if (options.all) {
    return runLocalCheckAll(cwd, cfg, outDirAbs, indexFiles);
  }

  return runLocalCheckOne(cwd, cfg, outDirAbs, indexFiles[0]);
}

async function assertOutputExists(outDirAbs: string, outDir: string): Promise<void> {
  if (!(await fs.pathExists(outDirAbs))) {
    throw renderShieldError(
      "VERIFY_FAILED",
      `No prerender output directory found: ${outDir}/. Run: rendershield build`,
      { outDir }
    );
  }
}

async function runLocalSmoke(
  cwd: string,
  options: VerifyOptions
): Promise<VerifyLocalResult> {
  const cfg = await loadConfig(cwd, options);
  const outDirAbs = path.join(cwd, cfg.output.outDir);
  await assertOutputExists(outDirAbs, cfg.output.outDir);

  const indexFiles = await listPrerenderIndexFiles(outDirAbs);
  if (indexFiles.length === 0) {
    throw renderShieldError(
      "VERIFY_FAILED",
      `No prerendered pages found inside: ${cfg.output.outDir}/. Run: rendershield build`,
      { outDir: cfg.output.outDir }
    );
  }

  const firstIndex = indexFiles[0];
  const routePath = indexHtmlPathToRoute(outDirAbs, firstIndex);
  const url = joinUrl(cfg.site.canonicalBase, routePath);
  const outputFile = path.relative(cwd, firstIndex);

  console.log(`
RenderShield verify

Using:
  canonicalBase: ${cfg.site.canonicalBase}
  routePath:     ${routePath}
  output file:   ${outputFile}
  pages in output: ${indexFiles.length} (showing first; use --all --check to validate all)

Smoke tests:

1) Human (usually SPA shell):
  curl -s ${url} | grep -i "<title>"

2) Bot (should see prerendered, route-specific title):
  curl -s -H "User-Agent: Googlebot" ${url} | grep -i "<title>"

3) Debug headers (Worker must be routed + proxy ON):
  curl -I -H "User-Agent: GPTBot" ${url}

Expected: x-rendershield: bot-hit (proves Worker served prerender to bot).
If debugHeaders enabled: X-Bot-Detected, X-Prerender, X-Final-Path.

Tip: rendershield verify --check validates built HTML without fetching production.
`);

  return {
    mode: "local",
    canonicalBase: cfg.site.canonicalBase,
    checked: false,
    ok: true,
    pages: [{ routePath, outputFile, url }],
  };
}

async function runLocalCheckOne(
  cwd: string,
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  outDirAbs: string,
  indexPath: string
): Promise<VerifyLocalResult> {
  const page = await checkLocalPage(cwd, outDirAbs, indexPath, cfg.site.canonicalBase);
  const ok = page.contract?.ok ?? false;

  console.log(`
RenderShield verify --check
Route: ${page.routePath}
File:  ${page.outputFile}
Contract: ${ok ? "PASS" : "FAIL"}
${!ok && page.contract ? page.contract.missing.map((m) => `  - ${m}`).join("\n") : ""}
`);

  if (!ok) {
    throw renderShieldError(
      "VERIFY_FAILED",
      `Built HTML failed contract for ${page.routePath}. Missing: ${page.contract?.missing.join("; ")}`,
      { routePath: page.routePath, missing: page.contract?.missing }
    );
  }

  return {
    mode: "local",
    canonicalBase: cfg.site.canonicalBase,
    checked: true,
    ok: true,
    pages: [page],
  };
}

async function runLocalCheckAll(
  cwd: string,
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  outDirAbs: string,
  indexFiles: string[]
): Promise<VerifyLocalResult> {
  const pages: VerifyPageResult[] = [];
  const failures: string[] = [];

  for (const indexPath of indexFiles) {
    const page = await checkLocalPage(cwd, outDirAbs, indexPath, cfg.site.canonicalBase);
    pages.push(page);
    if (!page.contract?.ok) {
      failures.push(
        `${page.routePath}: ${page.contract?.missing.join("; ") ?? "contract failed"}`
      );
    }
  }

  console.log(`
RenderShield verify --all --check
Pages: ${pages.length}
${pages
  .map((p) => `  ${p.contract?.ok ? "PASS" : "FAIL"}  ${p.routePath}`)
  .join("\n")}
`);

  if (failures.length > 0) {
    throw renderShieldError(
      "VERIFY_FAILED",
      `Built HTML failed contract on ${failures.length} page(s). ${failures.join(" | ")}`,
      { failures }
    );
  }

  return {
    mode: "local",
    canonicalBase: cfg.site.canonicalBase,
    checked: true,
    ok: true,
    pages,
  };
}

async function checkLocalPage(
  cwd: string,
  outDirAbs: string,
  indexPath: string,
  canonicalBase: string
): Promise<VerifyPageResult> {
  const html = await fs.readFile(indexPath, "utf8");
  const routePath = indexHtmlPathToRoute(outDirAbs, indexPath);
  const outputFile = path.relative(cwd, indexPath);
  const contract = checkPrerenderContract(html, {
    routePath,
    outFile: outputFile,
  });
  return {
    routePath,
    outputFile,
    url: joinUrl(canonicalBase, routePath),
    contract,
  };
}

async function runVerifyProdAll(
  cfg: Awaited<ReturnType<typeof loadConfig>>,
  _cwd: string,
  outDirAbs: string,
  indexFiles: string[]
): Promise<VerifyProdResult> {
  const pages: VerifyProdResult["pages"] = [];
  const failures: string[] = [];

  for (const indexPath of indexFiles) {
    const routePath = indexHtmlPathToRoute(outDirAbs, indexPath);
    const prodUrl = joinUrl(cfg.site.canonicalBase, routePath);
    try {
      const result = await fetchAndVerifyProd(prodUrl);
      pages.push(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${routePath}: ${msg}`);
    }
  }

  console.log(`
RenderShield verify --prod --all
Checked ${pages.length} URL(s) from build output.
`);

  if (failures.length > 0) {
    throw renderShieldError(
      "VERIFY_FAILED",
      `Production verify failed for ${failures.length} route(s). ${failures.join(" | ")}`,
      { failures }
    );
  }

  return { mode: "prod", ok: true, pages };
}

async function fetchAndVerifyProd(
  normalizedUrl: string
): Promise<{ url: string; contract: ContractCheckResult }> {
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

  if (xRenderShield === "bot-fallback") {
    throw renderShieldError(
      "VERIFY_FAILED",
      `verify --prod: bot request received x-rendershield: bot-fallback for ${normalizedUrl}. ` +
        `Prerender origin returned non-200; Worker fell back to SPA.`,
      { url: normalizedUrl, xRenderShield }
    );
  }
  if (xRenderShield !== "bot-hit") {
    const hint = xRenderShield == null
      ? " If no Worker is deployed, use verify --check for local/build output."
      : "";
    throw renderShieldError(
      "VERIFY_FAILED",
      `verify --prod: expected x-rendershield: bot-hit for ${normalizedUrl}. ` +
        `Got: ${xRenderShield ?? "(missing)"}.${hint}`,
      { url: normalizedUrl, xRenderShield }
    );
  }

  const contract = checkPrerenderContract(botHtml, {
    routePath: normalizedUrl,
    outFile: normalizedUrl,
  });

  const humanSpa = looksLikeSpaShell(humanHtml);

  console.log(`
RenderShield verify --prod
URL: ${normalizedUrl}

Fetch:
  Bot (Googlebot):   ${botStatus}  (${botHtml.length} bytes)  x-rendershield: ${xRenderShield}
  Human (Chrome):    ${humanStatus}  (${humanHtml.length} bytes)

Routing:  x-rendershield: bot-hit

Bot contract:
  ${contract.ok ? "PASS" : "FAIL"}
${contract.missing.length > 0 ? contract.missing.map((m) => `  - ${m}`).join("\n") : ""}

Human response:
  ${humanSpa.likely ? `Likely SPA shell: ${humanSpa.reason ?? "unknown"}` : "Has substantial content."}
`);

  if (!contract.ok) {
    throw renderShieldError(
      "VERIFY_FAILED",
      `Production URL did not satisfy bot contract: ${normalizedUrl}. Missing: ${contract.missing.join("; ")}`,
      { url: normalizedUrl, missing: contract.missing }
    );
  }

  return { url: normalizedUrl, contract };
}
