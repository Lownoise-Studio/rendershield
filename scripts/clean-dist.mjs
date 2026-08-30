#!/usr/bin/env node
/**
 * Remove the TypeScript outDir so orphaned compiled files from another
 * branch/build cannot survive into `npm pack` / publish.
 *
 * Uses only Node built-ins (no extra dependencies).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");

fs.rmSync(distDir, { recursive: true, force: true });
