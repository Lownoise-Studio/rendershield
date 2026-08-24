import { describe, it, expect, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import {
  captureProjectTree,
  snapshotsEqual,
} from "./helpers/projectTreeSnapshot.js";

describe("projectTreeSnapshot root metadata", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.remove(tmpDir).catch(() => {});
  });

  it("detects transient root-level create/delete via root mtime", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-tree-root-"));
    const stableFile = path.join(tmpDir, "stable.txt");
    await fs.writeFile(stableFile, "stable fixture\n", "utf8");

    // Force a known-old root mtime so create/delete is observable without sleeps.
    const oldMs = Date.UTC(2000, 0, 1, 0, 0, 0);
    const oldSec = oldMs / 1000;
    await fs.utimes(tmpDir, oldSec, oldSec);

    const before = await captureProjectTree(tmpDir);
    expect(before.has(".")).toBe(true);
    expect(before.get(".")?.type).toBe("directory");
    expect(before.get(".")?.mtimeMs).toBe(oldMs);
    expect(before.has("stable.txt")).toBe(true);

    const transient = path.join(tmpDir, ".doctor-transient-test");
    await fs.writeFile(transient, "transient\n", "utf8");
    await fs.remove(transient);

    const after = await captureProjectTree(tmpDir);

    expect(before.has(".doctor-transient-test")).toBe(false);
    expect(after.has(".doctor-transient-test")).toBe(false);

    const beforeWithoutRoot = new Map(
      [...before.entries()].filter(([rel]) => rel !== ".")
    );
    const afterWithoutRoot = new Map(
      [...after.entries()].filter(([rel]) => rel !== ".")
    );
    expect(snapshotsEqual(beforeWithoutRoot, afterWithoutRoot)).toBe(true);

    expect(after.has(".")).toBe(true);
    expect(after.get(".")?.mtimeMs).not.toBe(before.get(".")?.mtimeMs);
    expect(snapshotsEqual(before, after)).toBe(false);
  });

  it("includes \".\" for an empty existing root", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rs-tree-empty-"));
    const snapshot = await captureProjectTree(tmpDir);
    expect(snapshot.size).toBe(1);
    expect(snapshot.get(".")?.type).toBe("directory");
  });
});
