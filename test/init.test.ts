import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { cmdInit } from "../dist/commands/init.js";

const CONFIG_NAME = "rendershield.config.json";

describe("cmdInit", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rendershield-init-"));
  });

  afterEach(async () => {
    await fs.remove(tmpDir).catch(() => {});
  });

  it("creates config and sample content in an empty directory", async () => {
    await cmdInit(tmpDir);

    await expect(fs.pathExists(path.join(tmpDir, CONFIG_NAME))).resolves.toBe(true);
    await expect(
      fs.pathExists(path.join(tmpDir, "content", "blog", "hello-world.md"))
    ).resolves.toBe(true);

    const config = JSON.parse(
      await fs.readFile(path.join(tmpDir, CONFIG_NAME), "utf8")
    );
    expect(config.version).toBe(1);
    expect(config.output.outDir).toBe("dist-prerender");
  });

  it("is non-destructive when run twice", async () => {
    await cmdInit(tmpDir);
    const configPath = path.join(tmpDir, CONFIG_NAME);
    const samplePath = path.join(tmpDir, "content", "blog", "hello-world.md");

    await fs.writeFile(configPath, '{"version":1,"custom":true}', "utf8");
    await fs.writeFile(samplePath, "custom sample", "utf8");

    await cmdInit(tmpDir);

    await expect(fs.readFile(configPath, "utf8")).resolves.toBe('{"version":1,"custom":true}');
    await expect(fs.readFile(samplePath, "utf8")).resolves.toBe("custom sample");
  });
});
