#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const OUT_DIR = "dist-prerender";

function fail(msg) {
  console.error(`\nRenderShield smoke test FAILED:\n${msg}\n`);
  process.exit(1);
}

function findFirstIndexHtml(dir) {
  const stack = [dir];

  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const e of entries) {
      const full = path.join(current, e.name);

      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (e.isFile() && e.name === "index.html") {
        const rel = path.relative(dir, path.dirname(full));
        if (rel && !rel.startsWith("..")) return full;
      }
    }
  }

  return null;
}

function assertContains(html, label, regex) {
  if (!regex.test(html)) {
    fail(`Missing or invalid ${label}`);
  }
}

if (!fs.existsSync(OUT_DIR)) {
  fail(`Output directory not found: ${OUT_DIR}. Run rendershield build first.`);
}

const indexPath = findFirstIndexHtml(OUT_DIR);

if (!indexPath) {
  fail(`No index.html found under ${OUT_DIR}`);
}

const html = fs.readFileSync(indexPath, "utf8");

assertContains(html, "<title>", /<title>[^<]+<\/title>/i);
assertContains(
  html,
  "meta description",
  /<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/i
);
assertContains(
  html,
  "canonical link",
  /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']+["']/i
);
assertContains(
  html,
  "Open Graph tags",
  /property=["']og:title["']|property=["']og:description["']|property=["']og:image["']|property=["']og:url["']/i
);
assertContains(
  html,
  "JSON-LD",
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]{20,}<\/script>/i
);
assertContains(
  html,
  "<article>",
  /<article[\s\S]*?>[\s\S]{80,}<\/article>/i
);

console.log(
  `RenderShield smoke test PASSED\nChecked: ${indexPath}`
);
