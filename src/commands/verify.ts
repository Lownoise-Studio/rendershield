import fs from "fs-extra";
import path from "node:path";
import { loadConfig } from "../core/loadConfig.js";

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
        // Ignore index.html at root; prefer a route page like blog/slug/index.html
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
  // rel: blog/hello-world/index.html
  const noFile = rel.replace(/index\.html$/i, "");
  const normalized = noFile.split(path.sep).join("/").replace(/\/+$/, "");
  return "/" + normalized.replace(/^\/+/, "");
}

export async function cmdVerify(cwd = process.cwd()) {
  const cfg = await loadConfig(cwd);

  const outDirAbs = path.join(cwd, cfg.output.outDir);
  const exists = await fs.pathExists(outDirAbs);

  if (!exists) {
    console.log(`
RenderShield verify

No prerender output directory found: ${cfg.output.outDir}/

Run:
  node dist/cli.js build
`);
    return;
  }

  const firstIndex = await findFirstIndexHtml(outDirAbs);

  if (!firstIndex) {
    console.log(`
RenderShield verify

No prerendered pages found inside: ${cfg.output.outDir}/

Run:
  node dist/cli.js build
`);
    return;
  }

  const routePath = indexHtmlPathToRoute(outDirAbs, firstIndex);
  const url = joinUrl(cfg.site.canonicalBase, routePath);

  console.log(`
RenderShield verify

Using:
  canonicalBase: ${cfg.site.canonicalBase}
  routePath:     ${routePath}
  output file:   ${path.relative(cwd, firstIndex)}

Smoke tests:

1) Human (usually SPA shell):
  curl -s ${url} | grep -i "<title>"

2) Bot (should see prerendered, route-specific title):
  curl -s -H "User-Agent: Googlebot" ${url} | grep -i "<title>"

3) Debug headers (Worker must be routed + proxy ON):
  curl -I -H "User-Agent: GPTBot" ${url}

Expected headers (if debugHeaders enabled):
  X-Bot-Detected: true
  X-Prerender: true
  X-Final-Path: ${routePath.replace(/\/?$/, "/index.html")}
`);
}
